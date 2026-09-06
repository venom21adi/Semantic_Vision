"""Per-file tree-sitter extraction into the same intermediate ("raw")
structures Python's/JS's extractors produce (`parser/extractor.py`) --
see that module's docstring for the raw/resolved boundary this mirrors:
this module only looks at a single file's syntax tree, never resolves
names across files.

Simpler than `javascript_extractor.py` in two structural ways, both
direct consequences of Java's grammar: only one tree-sitter grammar
exists for the whole language (no JS/TS/JSX-style family to dispatch
across), and Java has no bare top-level functions or expression-level
class/function values -- every method lives inside a class/interface/
enum, and a class can only appear as its own declaration statement, never
as the value of a variable declarator. That removes an entire category of
JS/Python extraction complexity (arrow functions, class expressions,
function expressions bound to a name) with no Java equivalent to handle.

Resolution and syntax-error handling are explicitly out of scope here,
same boundary as the Python/JS extractors -- tree-sitter never raises on
malformed input, it always returns a best-effort tree; translating that
into a `ParseSyntaxError` belongs to `languages/java.py`'s adapter, not
this module.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_java

from semantic_vision.parser.extractor import (
    RawCall,
    RawClass,
    RawFunction,
    RawImport,
    RawModule,
    RawVariable,
)

Node = tree_sitter.Node

JAVA = tree_sitter.Language(tree_sitter_java.language())
FILE_EXTENSIONS = frozenset({".java"})

# `class`/`interface`/`enum` all define methods and all become `RawClass`
# nodes (there's no `NodeKind.INTERFACE`/`ENUM` -- `models.py` doesn't
# change for a new language, so interfaces/enums simply show up as plain
# classes in the graph, same as every other construct here). `record`
# declarations are deliberately excluded: a record's components
# implicitly synthesize fields/accessors that aren't textually present
# in the body, which breaks the "extract exactly what's in the source"
# model every other construct here follows -- a documented follow-up,
# not a redesign, if/when it's needed (its `name`/`body` field shape is
# close enough to slot into this set later).
_TYPE_DECLARATION_TYPES = {"class_declaration", "interface_declaration", "enum_declaration"}

# `enum_body`'s post-`;` members (methods/fields/constructors declared
# after the enum constants) sit inside their own wrapper node, unlike
# `class_body`/`interface_body` where members are direct named children
# -- confirmed by direct inspection. Transparently unwrapped in
# `_iter_class_members` below rather than given its own code path.
_ENUM_BODY_DECLARATIONS = "enum_body_declarations"


def _text(node: Node | None) -> str | None:
    return node.text.decode("utf-8") if node is not None else None


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _end_line(node: Node) -> int:
    return node.end_point[0] + 1


def _dotted_name(node: Node | None) -> str | None:
    """Flatten a `field_access`/`identifier`/`this` chain (e.g.
    `System.out`, `this.count`) into a dotted string -- the Java analogue
    of the JS extractor's `_dotted_name` over `member_expression`. `None`
    for anything more dynamic (an array access, a call result, etc.)
    that can't be statically resolved to a single reference. A bare
    `scoped_identifier` (e.g. `a.b.c`, used for package-qualified names
    rather than object field access) already carries its full dotted
    text on the one node, so it's handled directly rather than needing
    the same recursive object/field walk."""
    if node is None:
        return None
    if node.type in ("identifier", "scoped_identifier"):
        return _text(node)
    if node.type == "this":
        return "this"
    if node.type == "field_access":
        obj = node.child_by_field_name("object")
        field = node.child_by_field_name("field")
        if field is None:
            return None
        obj_dotted = _dotted_name(obj)
        if obj_dotted is None:
            return None
        return f"{obj_dotted}.{_text(field)}"
    return None


def _type_name(node: Node | None) -> str | None:
    """Flatten an `object_creation_expression`'s `type` field into a
    dotted string. `type_identifier`/`scoped_type_identifier` already
    carry their full text as the dotted name (confirmed by direct
    inspection -- `scoped_type_identifier`'s own text is the whole
    qualified name, not just its last segment); `generic_type` (e.g.
    `ArrayList<String>`, `java.util.Map<K, V>`) wraps the actual type as
    its first named child, with `type_arguments` as the second -- there
    is no named field for this, confirmed by direct inspection."""
    if node is None:
        return None
    if node.type in ("type_identifier", "scoped_type_identifier"):
        return _text(node)
    if node.type == "generic_type" and node.named_children:
        return _type_name(node.named_children[0])
    return None


def _collect_calls(node: Node, calls: list[RawCall]) -> None:
    """Collects every call (`method_invocation`/`object_creation_expression`)
    reachable from `node`. Nested method/constructor bodies are
    intentionally *not* stopped at -- Java has no expression-level
    function values to worry about, so the only real nested scope is a
    local class, which (like a nested top-level class) gets its own
    symbol and must not be double-counted here.

    `method_invocation` with no `object` field is a bare call
    (`doStuff()`) -- Java allows this as shorthand for an implicit `this`
    receiver inside an instance method, unlike Python/JS where the
    receiver is always written explicitly. Normalized to `this.<name>`
    here, at extraction time, so it flows through `resolve_calls`'s
    existing `self_names` branch with no resolver changes. Known,
    accepted trade-off: a bare call to a *statically-imported* member
    (`import static a.b.C.member; ... member();`) would incorrectly try
    the current class's own methods first via this same path and land in
    `unresolved` rather than matching its static-import binding -- a
    narrow miss on one Java idiom, clearly better than leaving every
    implicit-`this` call (the overwhelmingly common case) unresolved.
    """
    if node.type in _TYPE_DECLARATION_TYPES:
        return
    if node.type == "method_invocation":
        obj = node.child_by_field_name("object")
        name_node = node.child_by_field_name("name")
        name = _text(name_node)
        if obj is not None:
            obj_dotted = _dotted_name(obj)
            dotted = f"{obj_dotted}.{name}" if obj_dotted is not None and name else None
        else:
            dotted = f"this.{name}" if name else None
        calls.append(RawCall(dotted=dotted, lineno=_line(node)))
    elif node.type == "object_creation_expression":
        dotted = _type_name(node.child_by_field_name("type"))
        calls.append(RawCall(dotted=dotted, lineno=_line(node)))
    for child in node.children:
        _collect_calls(child, calls)


def _find_nested_classes(body: Node) -> list[Node]:
    """Local classes declared directly as statements in a method/
    constructor body, including ones wrapped in control flow -- mirrors
    the JS/Python extractors' nested-class discovery, simplified for
    Java's much narrower set of "a class can appear here" shapes: Java
    has no expression-level class value (no analogue of JS's
    `const X = class { ... }`), so a class only ever appears as its own
    plain declaration statement, confirmed by direct inspection against
    a local class declared inside a method body."""
    found: list[Node] = []
    for child in body.named_children:
        if child.type in _TYPE_DECLARATION_TYPES:
            found.append(child)
        elif child.type not in ("method_declaration", "constructor_declaration"):
            found.extend(_find_nested_classes(child))
    return found


def _extract_function(node: Node, name: str) -> RawFunction:
    """Shared by `method_declaration` and `constructor_declaration` --
    both have `name`/`body`/`parameters` fields with the same shape.
    `decorator_calls` stays empty: Java annotations (`@Override`,
    `@Table(name = "x")`) are compile-time/reflection metadata, never an
    actual runtime call the way a Python/JS decorator is, so representing
    one as a `RawCall` would misrepresent what's actually happening at
    runtime -- deliberately not extracted, not a gap."""
    body = node.child_by_field_name("body")
    calls: list[RawCall] = []
    nested_classes: list[RawClass] = []
    if body is not None:
        _collect_calls(body, calls)
        nested_classes = [_extract_class(n) for n in _find_nested_classes(body)]
    return RawFunction(
        name=name,
        lineno=_line(node),
        end_lineno=_end_line(node),
        calls=calls,
        nested_classes=nested_classes,
    )


def _iter_class_members(body: Node) -> list[Node]:
    """Direct members of a `class_body`/`interface_body`/`enum_body`.
    `enum_body`'s post-`;` members sit inside an `enum_body_declarations`
    wrapper (see the module-level comment) -- transparently unwrapped
    here so callers never need to know which body type they're looking
    at."""
    members: list[Node] = []
    for child in body.named_children:
        if child.type == _ENUM_BODY_DECLARATIONS:
            members.extend(child.named_children)
        else:
            members.append(child)
    return members


def _extract_class(node: Node) -> RawClass:
    name_node = node.child_by_field_name("name")
    class_name = _text(name_node) or "<anonymous>"
    body = node.child_by_field_name("body")

    methods: list[RawFunction] = []
    attributes: list[RawVariable] = []
    nested_classes: list[RawClass] = []
    if body is not None:
        for member in _iter_class_members(body):
            if member.type in ("method_declaration", "constructor_declaration"):
                member_name_node = member.child_by_field_name("name")
                if member_name_node is None:
                    continue
                methods.append(_extract_function(member, _text(member_name_node) or ""))
            elif member.type == "field_declaration":
                type_node = member.child_by_field_name("type")
                annotation = _text(type_node)
                for declarator in member.children_by_field_name("declarator"):
                    field_name_node = declarator.child_by_field_name("name")
                    if field_name_node is None:
                        continue
                    attributes.append(
                        RawVariable(
                            name=_text(field_name_node) or "",
                            lineno=_line(declarator),
                            annotation=annotation,
                        )
                    )
            elif member.type in _TYPE_DECLARATION_TYPES:
                nested_classes.append(_extract_class(member))

    return RawClass(
        name=class_name,
        lineno=_line(node),
        end_lineno=_end_line(node),
        methods=methods,
        attributes=attributes,
        nested_classes=nested_classes,
    )


def _extract_import(node: Node) -> RawImport:
    """`import_declaration` exposes no named fields at all (confirmed by
    direct inspection) -- its shape is read purely from its plain
    children: an optional leading `static` keyword, then a
    `scoped_identifier` (whose own text is already the full dotted path,
    needing no manual flattening) or `identifier` (a single-segment
    import, e.g. `import Foo;` for the default package), optionally
    followed by a `.` + `asterisk` pair for a wildcard.

    Maps onto `RawImport`'s existing fields with no dataclass changes,
    repurposing the otherwise-dead-for-Java `level` field (Java has no
    relative imports) as a static-import marker -- the same kind of
    in-pattern field reuse the JS extractor already does with `name`'s
    `"*"`/`"default"` sentinels:

    | Java form                          | module      | name     | level |
    |-------------------------------------|-------------|----------|-------|
    | `import a.b.C;`                     | `"a.b"`     | `"C"`    | 0     |
    | `import a.b.*;`                     | `"a.b"`     | `"*"`    | 0     |
    | `import static a.b.C.member;`       | `"a.b.C"`   | `"member"`| 1    |
    | `import static a.b.C.*;`            | `"a.b.C"`   | `"*"`    | 1     |
    """
    is_static = any(child.type == "static" for child in node.children)
    is_wildcard = any(child.type == "asterisk" for child in node.children)
    dotted_node = next(
        (c for c in node.children if c.type in ("scoped_identifier", "identifier")), None
    )
    dotted = _text(dotted_node) or ""

    if is_wildcard:
        module, name = dotted, "*"
    else:
        module, _, name = dotted.rpartition(".")
        if not module:
            # A single-segment import (`import Foo;`, the default
            # package) -- rpartition finds no ".", so `module` would be
            # "" and `name` would be "". Fall back to treating the whole
            # dotted string as the imported name with no package.
            module, name = None, dotted

    return RawImport(
        module=module, name=name, asname=None, level=1 if is_static else 0, lineno=_line(node)
    )


def parse_tree(source: str, rel_path: str) -> tree_sitter.Tree:
    """Parse `source` with the Java grammar. `rel_path` is accepted only
    for interface symmetry with `javascript_extractor.parse_tree` (which
    needs it to pick a grammar) -- Java has exactly one grammar, so it's
    unused here. tree-sitter never raises on malformed input -- check the
    returned tree's `root_node.has_error` (see `first_error_line`) if
    that matters to the caller."""
    del rel_path
    return tree_sitter.Parser(JAVA).parse(source.encode("utf-8"))


def first_error_line(tree: tree_sitter.Tree) -> int | None:
    """Best-effort location of the first syntax error in `tree`, for a
    caller that wants to report *something* -- not a full diagnostic.
    Walks only the path flagged by `has_error`, not the whole tree."""

    def _search(node: Node) -> int | None:
        if node.type == "ERROR" or node.is_missing:
            return _line(node)
        for child in node.children:
            if child.has_error:
                found = _search(child)
                if found is not None:
                    return found
        return None

    if not tree.root_node.has_error:
        return None
    return _search(tree.root_node)


def extract_java_module(source: str, rel_path: str) -> RawModule:
    """Parse `source` and extract it in one step -- a convenience for
    tests and other direct callers that don't need syntax-error
    reporting. `languages/java.py`'s adapter does *not* use this: it
    needs the intermediate `Tree` to check `has_error` before extracting,
    so it calls `parse_tree`/`extract_module` separately instead."""
    tree = parse_tree(source, rel_path)
    return extract_module(tree, rel_path)


def extract_module(tree: tree_sitter.Tree, rel_path: str) -> RawModule:
    """Java has no bare top-level functions and no top-level variables --
    every method lives inside a class/interface/enum, and there's no
    module-level statement that binds a name the way Python's/JS's
    module-level assignments do -- so `RawModule.functions`/`.variables`
    stay empty for every Java file; only `.imports`/`.classes` are ever
    populated. This is the exact simplification the build plan called
    out for Java relative to Python's mixed module/class/method model."""
    module = RawModule(rel_path=rel_path)
    for child in tree.root_node.named_children:
        if child.type == "import_declaration":
            module.imports.append(_extract_import(child))
        elif child.type in _TYPE_DECLARATION_TYPES:
            module.classes.append(_extract_class(child))
    return module
