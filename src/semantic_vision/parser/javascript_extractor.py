"""Per-file tree-sitter extraction into the same intermediate ("raw")
structures Python's extractor produces (`parser/extractor.py`) -- see
that module's docstring for the raw/resolved boundary this mirrors:
this module only looks at a single file's syntax tree, never resolves
names across files.

Handles the whole JS/TS/JSX/TSX family with one walker: the node types
this project cares about (function/class/import/call shapes) are
consistent across all three tree-sitter grammars, confirmed directly
against real samples parsed with each one. The only per-grammar
divergences are two node-type renames (class name: `identifier` vs
`type_identifier`; class field: `field_definition` vs
`public_field_definition`), both handled as "accept either" below
rather than as separate code paths.

Resolution (turning a `RawImport`/`RawCall` into an actual edge) and
syntax-error handling are explicitly out of scope here, same boundary
as the Python extractor -- tree-sitter never raises on malformed input,
it always returns a best-effort tree; translating that into a
`ParseSyntaxError` belongs to the future JS `LanguageAdapter`, not this
module (importing `languages.base` here would invert the existing
one-directional `languages/` -> `parser/` dependency).
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_javascript
import tree_sitter_typescript

from semantic_vision.parser.extractor import (
    RawCall,
    RawClass,
    RawFunction,
    RawImport,
    RawModule,
    RawVariable,
)

Node = tree_sitter.Node

JAVASCRIPT = tree_sitter.Language(tree_sitter_javascript.language())
TYPESCRIPT = tree_sitter.Language(tree_sitter_typescript.language_typescript())
TSX = tree_sitter.Language(tree_sitter_typescript.language_tsx())

GRAMMAR_BY_EXTENSION: dict[str, tree_sitter.Language] = {
    ".js": JAVASCRIPT,
    ".jsx": JAVASCRIPT,
    ".mjs": JAVASCRIPT,
    ".cjs": JAVASCRIPT,
    ".ts": TYPESCRIPT,
    ".mts": TYPESCRIPT,
    ".cts": TYPESCRIPT,
    ".tsx": TSX,
}

_FIELD_DEFINITION_TYPES = {"field_definition", "public_field_definition"}

# Node types a scoped-def walk transparently recurses through -- none of
# them introduce a new function/class scope on their own, so a def
# wrapped in any of these (an `if`-guarded polyfill, a `try`-wrapped
# conditional definition, etc.) must still be found. Mirrors Python's
# `_iter_scoped_defs` handling of `if`/`for`/`while`/`try`/`with`/`match`.
_TRANSPARENT_CONTAINER_TYPES = {
    "program",
    "statement_block",
    "export_statement",
    "if_statement",
    "else_clause",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "try_statement",
    "catch_clause",
    "finally_clause",
    "switch_statement",
    "switch_body",
    "switch_case",
    "switch_default",
    "labeled_statement",
}

# A generator function declaration (`function* gen() {}`, including its
# `async function*` form) is a distinct node type from a plain function
# declaration, but behaves identically for extraction purposes -- same
# `name`/`body` fields, confirmed by direct inspection. Likewise a TS
# `abstract class` is a distinct node type from a plain class
# declaration, with the same `name`/`body` fields.
_FUNCTION_DECLARATION_TYPES = {"function_declaration", "generator_function_declaration"}
_CLASS_DECLARATION_TYPES = {"class_declaration", "abstract_class_declaration"}
# A `variable_declarator`'s value can be any of these and still be a
# named function for extraction purposes -- `generator_function` is the
# expression form of `function* () {}` (e.g. `const g = function* () {}`).
_FUNCTION_VALUE_TYPES = {"arrow_function", "function_expression", "generator_function"}

# Statement types that are themselves scoped defs, recognized directly
# rather than recursed through.
_SCOPED_DEF_TYPES = {
    "import_statement",
    *_FUNCTION_DECLARATION_TYPES,
    *_CLASS_DECLARATION_TYPES,
    "lexical_declaration",
    "variable_declaration",
}


def _grammar_for(rel_path: str) -> tree_sitter.Language:
    for ext, grammar in GRAMMAR_BY_EXTENSION.items():
        if rel_path.endswith(ext):
            return grammar
    raise ValueError(f"No JS/TS grammar registered for: {rel_path}")


def _text(node: Node | None) -> str | None:
    return node.text.decode("utf-8") if node is not None else None


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _end_line(node: Node) -> int:
    return node.end_point[0] + 1


def _string_literal_value(node: Node) -> str | None:
    """The unquoted text of a `string` node -- its `string_fragment`
    child, never the outer node's own text (which includes the quote
    characters)."""
    for child in node.children:
        if child.type == "string_fragment":
            return _text(child)
    return None


def _dotted_name(node: Node) -> str | None:
    """Flatten a `member_expression`/`identifier`/`this` chain (e.g.
    `os.path.join`, `this.prefix`) into a dotted string -- the tree-sitter
    analogue of Python's `_dotted_name` over `ast.Attribute`/`ast.Name`.
    `None` for anything more dynamic (computed member access, a call
    result, etc.) that can't be statically resolved to a single
    reference."""
    if node.type == "identifier":
        return _text(node)
    if node.type == "this":
        return "this"
    if node.type == "member_expression":
        obj = node.child_by_field_name("object")
        prop = node.child_by_field_name("property")
        if obj is None or prop is None or prop.type != "property_identifier":
            return None
        obj_dotted = _dotted_name(obj)
        if obj_dotted is None:
            return None
        return f"{obj_dotted}.{_text(prop)}"
    return None


def _annotation_to_str(type_annotation_node: Node | None) -> str | None:
    """`type_annotation`'s own text includes the leading `: ` (e.g.
    `": string"`); the actual type expression is its one named child."""
    if type_annotation_node is None or not type_annotation_node.named_children:
        return None
    return _text(type_annotation_node.named_children[0])


def _member_name(node: Node) -> Node | None:
    """A class member's name node. Prefer the `name` field (present on
    TS's `public_field_definition`/`method_definition`), falling back to
    scanning children for a `property_identifier`/`private_property_identifier`
    -- plain JS's `field_definition` doesn't expose a `name` field for
    this at all, confirmed via direct inspection, unlike its TS
    counterpart."""
    named = node.child_by_field_name("name")
    if named is not None:
        return named
    for child in node.children:
        if child.type in ("property_identifier", "private_property_identifier"):
            return child
    return None


def _collect_calls(node: Node, calls: list[RawCall]) -> None:
    """Collects every call (`call_expression`/`new_expression`) reachable
    from `node`. Nested function/arrow/method defs are intentionally
    *not* stopped at -- their calls flatten into the enclosing scope,
    mirroring Python's `_CallCollector` (no `visit_FunctionDef` override
    there either). Only a nested class boundary stops the walk (it gets
    its own symbol -- see `_extract_class` -- and must not be
    double-counted). `decorator`/`type_annotation` subtrees are excluded:
    decorators are collected separately via `_collect_decorator_calls`,
    and type positions can't contain runtime calls in valid JS/TS.
    """
    if node.type in ("class_declaration", "class", "decorator", "type_annotation"):
        return
    if node.type in ("call_expression", "new_expression"):
        callee = node.child_by_field_name("function") or node.child_by_field_name("constructor")
        dotted = _dotted_name(callee) if callee is not None else None
        calls.append(RawCall(dotted=dotted, lineno=_line(node)))
    for child in node.children:
        _collect_calls(child, calls)


def _collect_decorator_calls(decorators: list[Node]) -> list[RawCall]:
    calls: list[RawCall] = []
    for decorator in decorators:
        # A decorator is `@` + `call_expression` (`@Component(...)`) or
        # occasionally a bare reference (`@Injectable`, no call) -- only
        # the call form contributes a `RawCall`.
        for child in decorator.children:
            _collect_calls(child, calls)
    return calls


def _decorators_of(node: Node) -> list[Node]:
    return [child for child in node.children if child.type == "decorator"]


def _iter_scoped_defs(container: Node) -> list[Node]:
    """Statements that execute directly in `container`'s scope --
    imports, function/class declarations, and variable declarations
    (which may hold arrow/class-expression values) -- including ones
    wrapped in control flow, without descending into a nested
    function/class's own body (a different scope, walked separately when
    that def is itself extracted). Mirrors Python's `_iter_scoped_defs`.
    """
    found: list[Node] = []
    for child in container.named_children:
        if child.type in _SCOPED_DEF_TYPES:
            found.append(child)
        elif child.type in _TRANSPARENT_CONTAINER_TYPES:
            found.extend(_iter_scoped_defs(child))
    return found


def _find_nested_classes(container: Node) -> list[tuple[Node, str | None]]:
    """Classes reachable from this scope as `(node, explicit_name)` pairs
    -- `explicit_name` is set for an anonymous class expression bound by
    a declarator (the class node itself has no name field), `None` for a
    real class declaration (name comes from the node itself). Mirrors
    Python's `_find_nested_classes`: a function nested inside another
    function is never itself extracted as a separate symbol (its calls
    flatten into the enclosing scope via `_collect_calls`); closures are
    followed to *arbitrary* depth to find classes defined inside them --
    both through `function`/`function*` declarations and through
    arrow/function-expression values bound by a declarator, so a class
    nested inside `const f = () => { class Deep {} }` is found the same
    as one nested inside `function f() { class Deep {} }`, at any
    nesting depth of either style."""
    found: list[tuple[Node, str | None]] = []
    for item in _iter_scoped_defs(container):
        if item.type in _CLASS_DECLARATION_TYPES:
            found.append((item, None))
        elif item.type in _FUNCTION_DECLARATION_TYPES:
            body = item.child_by_field_name("body")
            if body is not None:
                found.extend(_find_nested_classes(body))
        elif item.type in ("lexical_declaration", "variable_declaration"):
            for declarator in item.named_children:
                if declarator.type != "variable_declarator":
                    continue
                name_node = declarator.child_by_field_name("name")
                value = declarator.child_by_field_name("value")
                if name_node is None or name_node.type != "identifier" or value is None:
                    continue
                if value.type == "class":
                    found.append((value, _text(name_node)))
                elif value.type in _FUNCTION_VALUE_TYPES:
                    value_body = value.child_by_field_name("body")
                    if value_body is not None and value_body.type == "statement_block":
                        found.extend(_find_nested_classes(value_body))
    return found


def _extract_function(
    func_node: Node, name: str, decorators: list[Node] | None = None
) -> RawFunction:
    body = func_node.child_by_field_name("body")
    calls: list[RawCall] = []
    nested_classes: list[RawClass] = []
    if body is not None:
        _collect_calls(body, calls)
        if body.type == "statement_block":
            nested_classes = [
                _extract_class(node, name=explicit_name)
                for node, explicit_name in _find_nested_classes(body)
            ]
    return RawFunction(
        name=name,
        lineno=_line(func_node),
        end_lineno=_end_line(func_node),
        calls=calls,
        decorator_calls=_collect_decorator_calls(decorators or []),
        nested_classes=nested_classes,
    )


def _extract_class(node: Node, name: str | None = None) -> RawClass:
    name_node = node.child_by_field_name("name")
    class_name = name if name is not None else (_text(name_node) or "<anonymous>")
    decorators = _decorators_of(node)
    body = node.child_by_field_name("body")

    methods: list[RawFunction] = []
    attributes: list[RawVariable] = []
    nested_classes: list[RawClass] = []
    if body is not None:
        # A `static { ... }` initialization block (`class_static_block`)
        # is deliberately not handled: it's neither a method nor a field,
        # `RawClass` has no "class-level init code" bucket to put its
        # calls in, and adding one would be a schema change out of scope
        # for this milestone. Falls through to the `else` branch below
        # and is silently skipped -- a known, accepted gap, not a bug.
        #
        # Method-level decorators (`@Get() findAll() {}`) appear as their
        # own sibling nodes immediately preceding the `method_definition`
        # they decorate, not as a field on it -- accumulate them here and
        # attach to whichever method comes next, mirroring how a
        # class-level decorator precedes `class_declaration` itself.
        pending_decorators: list[Node] = []
        for member in body.named_children:
            if member.type == "decorator":
                pending_decorators.append(member)
                continue
            if member.type == "method_definition":
                member_name_node = _member_name(member)
                if member_name_node is None:
                    pending_decorators = []
                    continue  # computed member name -- no name to bind, skip
                method_name = _text(member_name_node)
                methods.append(_extract_function(member, method_name, pending_decorators))
                pending_decorators = []
            elif member.type in _FIELD_DEFINITION_TYPES:
                member_name_node = _member_name(member)
                if member_name_node is None:
                    pending_decorators = []
                    continue
                member_name = _text(member_name_node)
                value = member.child_by_field_name("value")
                if value is not None and value.type in _FUNCTION_VALUE_TYPES:
                    methods.append(_extract_function(value, member_name, pending_decorators))
                elif value is not None and value.type == "class":
                    nested_classes.append(_extract_class(value, name=member_name))
                else:
                    attributes.append(
                        RawVariable(
                            name=member_name,
                            lineno=_line(member),
                            annotation=_annotation_to_str(member.child_by_field_name("type")),
                        )
                    )
                pending_decorators = []
            else:
                pending_decorators = []

    return RawClass(
        name=class_name,
        lineno=_line(node),
        end_lineno=_end_line(node),
        methods=methods,
        attributes=attributes,
        nested_classes=nested_classes,
        decorator_calls=_collect_decorator_calls(decorators),
    )


def _extract_declarators(stmt: Node) -> tuple[list[RawFunction], list[RawClass], list[RawVariable]]:
    functions: list[RawFunction] = []
    classes: list[RawClass] = []
    variables: list[RawVariable] = []
    for declarator in stmt.named_children:
        if declarator.type != "variable_declarator":
            continue
        name_node = declarator.child_by_field_name("name")
        if name_node is None or name_node.type != "identifier":
            continue  # a destructuring pattern -- no single name to bind, skip
        name = _text(name_node)
        value = declarator.child_by_field_name("value")
        if value is not None and value.type in _FUNCTION_VALUE_TYPES:
            functions.append(_extract_function(value, name))
        elif value is not None and value.type == "class":
            classes.append(_extract_class(value, name=name))
        else:
            variables.append(
                RawVariable(
                    name=name,
                    lineno=_line(declarator),
                    annotation=_annotation_to_str(declarator.child_by_field_name("type")),
                )
            )
    return functions, classes, variables


def _extract_import(stmt: Node) -> list[RawImport]:
    source_node = stmt.child_by_field_name("source")
    module = _string_literal_value(source_node) if source_node is not None else None
    lineno = _line(stmt)
    clause = next((c for c in stmt.children if c.type == "import_clause"), None)

    if clause is None:
        # Side-effect-only import: `import "m";` -- no bound name, mapped
        # the same way Python represents a bare `import x`.
        return [RawImport(module=None, name=module or "", asname=None, level=0, lineno=lineno)]

    imports: list[RawImport] = []
    for part in clause.children:
        if part.type == "identifier":
            # Default import: `import Foo from "m"`.
            imports.append(
                RawImport(module=module, name="default", asname=_text(part), level=0, lineno=lineno)
            )
        elif part.type == "namespace_import":
            ns_name = next((c for c in part.children if c.type == "identifier"), None)
            imports.append(
                RawImport(module=module, name="*", asname=_text(ns_name), level=0, lineno=lineno)
            )
        elif part.type == "named_imports":
            for spec in part.children:
                if spec.type != "import_specifier":
                    continue
                has_default_kw = any(c.type == "default" for c in spec.children)
                ids = [c for c in spec.children if c.type == "identifier"]
                if has_default_kw:
                    # `{ default as X }` -- semantically identical to a
                    # plain default import, produces the identical row.
                    asname = _text(ids[0]) if ids else None
                    imports.append(
                        RawImport(
                            module=module, name="default", asname=asname, level=0, lineno=lineno
                        )
                    )
                elif len(ids) == 2:
                    imports.append(
                        RawImport(
                            module=module,
                            name=_text(ids[0]),
                            asname=_text(ids[1]),
                            level=0,
                            lineno=lineno,
                        )
                    )
                elif len(ids) == 1:
                    imports.append(
                        RawImport(
                            module=module, name=_text(ids[0]), asname=None, level=0, lineno=lineno
                        )
                    )
    return imports


def extract_javascript_module(
    source: str, rel_path: str, grammar: tree_sitter.Language | None = None
) -> RawModule:
    """Parse `source` with the grammar selected from `rel_path`'s
    extension (or an explicit override, for tests), and extract it.
    Signature mirrors `LanguageAdapter.parse_file`'s `(source, rel_path)`
    exactly, so a future JS adapter can assign this directly with no
    wrapper."""
    lang = grammar if grammar is not None else _grammar_for(rel_path)
    tree = tree_sitter.Parser(lang).parse(source.encode("utf-8"))
    return _extract_module(tree, rel_path)


def _extract_module(tree: tree_sitter.Tree, rel_path: str) -> RawModule:
    module = RawModule(rel_path=rel_path)
    for stmt in _iter_scoped_defs(tree.root_node):
        if stmt.type == "import_statement":
            module.imports.extend(_extract_import(stmt))
        elif stmt.type in _FUNCTION_DECLARATION_TYPES:
            name_node = stmt.child_by_field_name("name")
            if name_node is not None:
                module.functions.append(_extract_function(stmt, _text(name_node)))
        elif stmt.type in _CLASS_DECLARATION_TYPES:
            module.classes.append(_extract_class(stmt))
        elif stmt.type in ("lexical_declaration", "variable_declaration"):
            functions, classes, variables = _extract_declarators(stmt)
            module.functions.extend(functions)
            module.classes.extend(classes)
            module.variables.extend(variables)
    return module
