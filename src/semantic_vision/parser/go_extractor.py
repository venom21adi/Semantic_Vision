"""Per-file tree-sitter extraction for Go into the same intermediate
("raw") structures every other language's extractor produces -- see
`parser/extractor.py`'s docstring for the raw/resolved boundary. Single
file's syntax only; nothing here resolves a name across files.

Go differs from the other supported languages in ways that shape this
module, each handled at extraction time so the shared resolver and
`models.py` stay untouched:

- **Methods are declared outside their type.** `func (s *Server) Run()` is
  a top-level declaration, and may live in a different file from
  `type Server struct{...}`. Methods are grouped by receiver type into a
  `RawClass` *per file*: if the type is declared in this file the class
  carries its real span, otherwise (methods-only file) the class spans just
  the methods. Same-package, cross-file lookups are `languages/go.py`'s job.
- **Receiver names are arbitrary** (`s`, `srv`, `r`...) unlike Python's
  fixed `self`. The receiver identifier is rewritten to `this` in every
  call's dotted name here, so the shared resolver's `self_names` mechanism
  works unchanged with `{"this"}`.
- **Interfaces** become classes with no methods: their method elements are
  signatures, not definitions, and a call through an interface value can't
  be statically resolved to one implementation anyway.
- **No `__init__`-style or class-nesting constructs**: no nested classes or
  decorators exist in Go, so those `Raw*` fields stay empty.
- Struct literals (`Server{...}`, `&pkg.Server{...}`) are recorded as calls
  to the type, the Go analogue of `Server()`/`new Server()` construction.

Syntax-error handling is the adapter's job (`languages/go.py`), same
boundary as every other extractor.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_go

from semantic_vision.parser.extractor import (
    RawCall,
    RawClass,
    RawFunction,
    RawImport,
    RawModule,
    RawVariable,
)

Node = tree_sitter.Node

GO = tree_sitter.Language(tree_sitter_go.language())
FILE_EXTENSIONS = frozenset({".go"})

# Node types a `type_spec`'s `type` field can have that make it a "class"
# on its own, with or without methods.
_STRUCT_LIKE = frozenset({"struct_type", "interface_type"})


def _text(node: Node | None) -> str | None:
    return node.text.decode("utf-8") if node is not None else None


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _end_line(node: Node) -> int:
    return node.end_point[0] + 1


def _type_name(node: Node | None) -> str | None:
    """The plain (possibly package-qualified) name of a type expression,
    peeling pointers and generic instantiations: `*Server` -> `Server`,
    `Box[T]` -> `Box`, `pkg.Server` -> `pkg.Server`. `None` for anything
    that isn't a nameable type (slice, map, func, channel, ...)."""
    if node is None:
        return None
    if node.type == "type_identifier":
        return _text(node)
    if node.type == "qualified_type":
        package = _text(node.child_by_field_name("package"))
        name = _text(node.child_by_field_name("name"))
        return f"{package}.{name}" if package and name else None
    if node.type == "pointer_type":
        inner = next((c for c in node.named_children), None)
        return _type_name(inner)
    if node.type == "generic_type":
        return _type_name(node.child_by_field_name("type"))
    return None


def _dotted_name(node: Node | None) -> str | None:
    """Flatten an `identifier`/`selector_expression` chain (`pkg.Fn`,
    `s.client.Do`) into a dotted string -- `None` for anything more dynamic
    (a call result, an index into a slice, a func literal) that can't be
    statically resolved to one reference. A generic instantiation
    `New[int]` flattens to just `New`."""
    if node is None:
        return None
    if node.type in ("identifier", "field_identifier", "package_identifier"):
        return _text(node)
    if node.type == "index_expression":
        # `New[int]` (generic instantiation) vs `fns[0]` (element of a
        # slice/map of funcs) are syntactically identical except when the
        # index is a literal, which can never be a type argument. A variable
        # index (`fns[i]()`) is indistinguishable, but harmless: `fns` is not
        # a function, so it just resolves to nothing.
        index = node.child_by_field_name("index")
        if index is not None and index.type.endswith("_literal"):
            return None
        return _dotted_name(node.child_by_field_name("operand"))
    if node.type == "selector_expression":
        operand = _dotted_name(node.child_by_field_name("operand"))
        field = _text(node.child_by_field_name("field"))
        if operand is None or not field:
            return None
        return f"{operand}.{field}"
    return None


# Prefix marking a *function value* reference (`http.HandleFunc("/", h)`,
# `&Cmd{Run: h}`) rather than a call. The shared resolver never resolves
# these (the prefixed root matches nothing), so `languages/go.py` picks them
# up as `unresolved::ref:...` edges, turns the ones that name a real
# package-level function/method into call edges, and drops the rest.
REF_PREFIX = "ref:"


def _local_names(func: Node) -> frozenset[str]:
    """Every name `func` binds *locally*: parameters, named results, `:=`,
    `var`/`const`, `range` and `select`-receive variables, type-switch
    aliases, and the same for nested closures. The receiver itself is
    excluded (it is the one name that is meant to resolve through the
    receiver type), so a receiver name appearing here means something
    inside the method *re*-declares it.

    Deliberately scope-blind (any binding anywhere in the function counts
    for the whole function): the two uses -- disabling the receiver->`this`
    rewrite, and not treating a variable as a function-value reference --
    both fail safe, losing an edge rather than inventing one."""
    names: set[str] = set()

    def add_identifiers(node: Node | None) -> None:
        if node is None:
            return
        if node.type == "identifier":
            names.add(_text(node) or "")
        else:
            names.update(_text(c) or "" for c in node.named_children if c.type == "identifier")

    receiver = func.child_by_field_name("receiver")
    stack = [c for c in func.children if c is not None and not _same(c, receiver)]
    while stack:
        node = stack.pop()
        t = node.type
        if t in ("short_var_declaration", "range_clause", "receive_statement"):
            add_identifiers(node.child_by_field_name("left"))
        elif t in ("var_spec", "const_spec"):
            names.update(_text(n) or "" for n in node.children_by_field_name("name"))
        elif t == "type_switch_statement":
            add_identifiers(node.child_by_field_name("alias"))
        elif t in ("parameter_declaration", "variadic_parameter_declaration"):
            names.update(_text(n) or "" for n in node.children_by_field_name("name"))
        stack.extend(node.children)
    names.discard("")
    names.discard("_")
    return frozenset(names)


def _same(a: Node, b: Node | None) -> bool:
    return b is not None and a.start_byte == b.start_byte and a.end_byte == b.end_byte


def _ref_name(
    node: Node | None,
    receiver: str | None,
    receiver_type: str | None,
    local_names: frozenset[str],
) -> str | None:
    """`ref:`-prefixed dotted name for an argument/literal value that is a
    bare identifier or selector chain, else `None`. A receiver-rooted
    selector (`s.handle`) is expressed through the receiver's *type*
    (`Server.handle`), since a `ref:` name never goes through the shared
    resolver's `this` handling."""
    if node is None or node.type not in ("identifier", "selector_expression"):
        return None
    dotted = _dotted_name(node)
    if dotted is None:
        return None
    root, sep, rest = dotted.partition(".")
    if receiver is not None and root == receiver:
        if not sep or receiver_type is None:
            return None
        dotted = f"{receiver_type}.{rest}"
    elif root in local_names:
        # A local variable/parameter, not a package-level function.
        return None
    return REF_PREFIX + dotted


def _collect_calls(
    node: Node,
    calls: list[RawCall],
    receiver: str | None,
    receiver_type: str | None = None,
    local_names: frozenset[str] = frozenset(),
) -> None:
    """Every call, struct-literal construction, and function-value
    reference reachable from `node`. Closures (`func_literal`) are
    deliberately *not* a boundary: their calls belong to the enclosing
    function, which is also what a reader of the call graph expects."""

    def add_ref(value: Node | None) -> None:
        ref = _ref_name(value, receiver, receiver_type, local_names)
        if ref is not None and value is not None:
            calls.append(RawCall(dotted=ref, lineno=_line(value)))

    def add_refs_of(container: Node | None) -> None:
        # `return a, b` / `x, y = a, b`: an expression_list of values.
        if container is None:
            return
        if container.type == "expression_list":
            for value in container.named_children:
                add_ref(value)
        else:
            add_ref(container)

    t = node.type
    if t == "call_expression":
        dotted = _dotted_name(node.child_by_field_name("function"))
        if dotted is not None and receiver is not None:
            root, sep, rest = dotted.partition(".")
            if root == receiver and sep:
                dotted = f"this.{rest}"
        calls.append(RawCall(dotted=dotted, lineno=_line(node)))
        arguments = node.child_by_field_name("arguments")
        for arg in arguments.named_children if arguments is not None else []:
            add_ref(arg)
    elif t == "composite_literal":
        # Only named types are constructions of something in the graph;
        # `[]int{...}` / `map[string]int{...}` are not.
        name = _type_name(node.child_by_field_name("type"))
        if name is not None:
            calls.append(RawCall(dotted=name, lineno=_line(node)))
    elif t == "keyed_element":
        # `Key: value` -- only the value can be a function reference.
        elements = [c for c in node.named_children if c.type == "literal_element"]
        if len(elements) == 2 and elements[1].named_children:
            add_ref(elements[1].named_children[0])
    elif (
        t == "literal_element"
        and node.parent is not None
        and node.parent.type == "literal_value"
        and node.named_children
    ):
        # A bare element (`[]func(){a, b}`), as opposed to a keyed one.
        add_ref(node.named_children[0])
    elif t == "return_statement":
        for child in node.named_children:
            add_refs_of(child)
    elif t in ("short_var_declaration", "assignment_statement"):
        add_refs_of(node.child_by_field_name("right"))
    elif t == "var_spec":
        add_refs_of(node.child_by_field_name("value"))
    elif t == "send_statement":
        add_refs_of(node.child_by_field_name("value"))
    for child in node.children:
        _collect_calls(child, calls, receiver, receiver_type, local_names)


def _receiver_info(method: Node) -> tuple[str | None, str | None]:
    """`(receiver identifier, receiver base type name)` for a
    `method_declaration`. The identifier is `None` for an unnamed (`(Server)`)
    or blank (`_`) receiver; the type is `None` only for a receiver whose
    type can't be named, in which case the method is dropped by the caller."""
    receiver_list = method.child_by_field_name("receiver")
    if receiver_list is None:
        return None, None
    decl = next(
        (c for c in receiver_list.named_children if c.type == "parameter_declaration"), None
    )
    if decl is None:
        return None, None
    name = _text(decl.child_by_field_name("name"))
    if name == "_":
        name = None
    return name, _type_name(decl.child_by_field_name("type"))


def _extract_function(
    node: Node, name: str, receiver: str | None, receiver_type: str | None = None
) -> RawFunction:
    body = node.child_by_field_name("body")
    calls: list[RawCall] = []
    if body is not None:
        local_names = _local_names(node)
        if receiver is not None and receiver in local_names:
            receiver = receiver_type = None
        _collect_calls(body, calls, receiver, receiver_type, local_names)
    return RawFunction(
        name=name,
        lineno=_line(node),
        end_lineno=_end_line(node),
        calls=calls,
    )


def _struct_fields(struct: Node) -> list[RawVariable]:
    attributes: list[RawVariable] = []
    field_list = next(
        (c for c in struct.named_children if c.type == "field_declaration_list"), None
    )
    if field_list is None:
        return attributes
    for decl in field_list.named_children:
        if decl.type != "field_declaration":
            continue
        type_node = decl.child_by_field_name("type")
        annotation = _text(type_node)
        names = decl.children_by_field_name("name")
        if names:
            for name_node in names:
                attributes.append(
                    RawVariable(
                        name=_text(name_node) or "", lineno=_line(name_node), annotation=annotation
                    )
                )
        else:
            # Embedded field: it's accessed by its type's own name.
            embedded = _type_name(type_node)
            if embedded:
                attributes.append(
                    RawVariable(
                        name=embedded.rsplit(".", 1)[-1], lineno=_line(decl), annotation=annotation
                    )
                )
    return attributes


def _extract_imports(node: Node) -> list[RawImport]:
    """One `RawImport` per `import_spec`. `module` is the full import path,
    `name` its last path segment (the usual package name -- the adapter's
    resolver refines this for `/vN` suffixes), `asname` the explicit alias:
    `"_"` for a blank import, `"."` for a dot import, `None` if none."""
    imports: list[RawImport] = []
    specs: list[Node] = []
    for child in node.named_children:
        if child.type == "import_spec":
            specs.append(child)
        elif child.type == "import_spec_list":
            specs.extend(c for c in child.named_children if c.type == "import_spec")
    for spec in specs:
        path_node = spec.child_by_field_name("path")
        path = _text(path_node)
        if not path:
            continue
        path = path.strip('`"')
        alias_node = spec.child_by_field_name("name")
        alias = _text(alias_node) if alias_node is not None else None
        imports.append(
            RawImport(
                module=path,
                name=path.rsplit("/", 1)[-1],
                asname=alias,
                level=0,
                lineno=_line(spec),
            )
        )
    return imports


def _extract_value_specs(node: Node) -> list[RawVariable]:
    """Package-level `var`/`const` names (blank `_` skipped)."""
    variables: list[RawVariable] = []
    specs: list[Node] = []
    for child in node.named_children:
        if child.type in ("var_spec", "const_spec"):
            specs.append(child)
        elif child.type in ("var_spec_list", "const_spec_list"):
            specs.extend(child.named_children)
    for spec in specs:
        annotation = _text(spec.child_by_field_name("type"))
        for name_node in spec.children_by_field_name("name"):
            name = _text(name_node)
            if name and name != "_":
                variables.append(
                    RawVariable(name=name, lineno=_line(name_node), annotation=annotation)
                )
    return variables


def parse_tree(source: str, rel_path: str) -> tree_sitter.Tree:
    """Parse `source` with the Go grammar. `rel_path` is unused (Go has one
    grammar) and kept for interface symmetry with the other extractors.
    tree-sitter never raises on malformed input -- check `root_node.has_error`."""
    del rel_path
    return tree_sitter.Parser(GO).parse(source.encode("utf-8"))


def first_error_line(tree: tree_sitter.Tree) -> int | None:
    """Best-effort line of the first syntax error, walking only the path
    flagged by `has_error`."""

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


def extract_go_module(source: str, rel_path: str) -> RawModule:
    """Parse and extract in one step, for tests/direct callers that don't
    need syntax-error reporting (the adapter calls `parse_tree` and
    `extract_module` separately so it can check `has_error` first)."""
    return extract_module(parse_tree(source, rel_path), rel_path)


def extract_module(tree: tree_sitter.Tree, rel_path: str) -> RawModule:
    module = RawModule(rel_path=rel_path)

    # type name -> (declaring node, is it a struct/interface)
    declared: dict[str, tuple[Node, bool]] = {}
    struct_nodes: dict[str, Node] = {}
    methods_by_type: dict[str, list[RawFunction]] = {}
    init_count = 0

    for child in tree.root_node.named_children:
        if child.type == "import_declaration":
            module.imports.extend(_extract_imports(child))
        elif child.type in ("var_declaration", "const_declaration"):
            module.variables.extend(_extract_value_specs(child))
        elif child.type == "type_declaration":
            for spec in child.named_children:
                if spec.type not in ("type_spec", "type_alias"):
                    continue
                name = _text(spec.child_by_field_name("name"))
                if not name or name == "_":
                    continue
                type_node = spec.child_by_field_name("type")
                is_struct_like = type_node is not None and type_node.type in _STRUCT_LIKE
                declared[name] = (spec, is_struct_like)
                if type_node is not None and type_node.type == "struct_type":
                    struct_nodes[name] = type_node
        elif child.type == "function_declaration":
            name = _text(child.child_by_field_name("name"))
            if not name or name == "_":
                continue
            if name == "init":
                # A package may declare any number of `init` functions
                # (even within one file) -- the only legal name repeat in
                # Go -- so later ones get a numeric suffix to keep their
                # node ids distinct.
                init_count += 1
                if init_count > 1:
                    name = f"init#{init_count}"
            module.functions.append(_extract_function(child, name, None))
        elif child.type == "method_declaration":
            name = _text(child.child_by_field_name("name"))
            receiver_name, receiver_type = _receiver_info(child)
            if not name or name == "_" or not receiver_type:
                continue
            # A qualified receiver type can't be legal Go (methods only on
            # local types); take the bare name defensively.
            type_name = receiver_type.rsplit(".", 1)[-1]
            methods_by_type.setdefault(type_name, []).append(
                _extract_function(child, name, receiver_name, type_name)
            )

    class_names = [n for n, (_, is_struct_like) in declared.items() if is_struct_like]
    class_names += [n for n in methods_by_type if n not in class_names]

    for name in class_names:
        methods = sorted(methods_by_type.get(name, []), key=lambda m: m.lineno)
        decl = declared.get(name)
        if decl is not None:
            lineno, end_lineno = _line(decl[0]), _end_line(decl[0])
        else:
            lineno = min(m.lineno for m in methods)
            end_lineno = max(m.end_lineno for m in methods)
        struct = struct_nodes.get(name)
        module.classes.append(
            RawClass(
                name=name,
                lineno=lineno,
                end_lineno=end_lineno,
                methods=methods,
                attributes=_struct_fields(struct) if struct is not None else [],
                declared_elsewhere=decl is None,
            )
        )
    module.classes.sort(key=lambda c: (c.lineno, c.name))
    return module
