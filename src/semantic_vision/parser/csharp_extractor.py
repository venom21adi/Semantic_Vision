"""Per-file tree-sitter extraction for C#, into the shared raw structures
(`parser/extractor.py`) plus a C#-specific payload (`lang_data`) that the
resolver (`resolver/csharp_resolver.py`) interprets.

Purely syntactic, like every extractor here: this module looks at one file's
syntax tree and never resolves a name across files. What it adds over the Java
extractor is the *type evidence* C# resolution needs, because a C# call such as
`conn.Query<T>(...)` can only be attributed by knowing what `conn` is:

- every call site is kept as a structured receiver expression (`CsExpr`) rather
  than a dotted string, so the resolver can type `a.B().C` step by step;
- every method records its parameters and the declared (or inferable) type of
  each local, pattern variable, `foreach` variable and lambda parameter;
- every type records its namespace, base types, and the declared type of each
  field/property, plus the `using` directives in effect.

C# specifics handled here: block and file-scoped namespaces, partial types,
records and primary constructors, properties/indexers with bodies, operators,
top-level statements, local functions and lambdas (their calls belong to the
enclosing method), conditional access (`a?.B()`), extension methods and
`global using`.

Syntax errors are *not* fatal: a file with preprocessor blocks tree-sitter
cannot parse (`#if ... #else` around half a statement) still yields everything
the best-effort tree contains. Rejecting such files would silently drop whole
files from the graph.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import tree_sitter
import tree_sitter_c_sharp

from semantic_vision.parser.extractor import (
    RawClass,
    RawFunction,
    RawImport,
    RawModule,
    RawVariable,
)

Node = tree_sitter.Node

CSHARP = tree_sitter.Language(tree_sitter_c_sharp.language())
FILE_EXTENSIONS = frozenset({".cs"})
EXCLUDED_DIRS = frozenset({"bin", "obj"})

TYPE_DECLARATION_TYPES = frozenset(
    {
        "class_declaration",
        "struct_declaration",
        "interface_declaration",
        "record_declaration",
        "record_struct_declaration",
        "enum_declaration",
    }
)
_KIND_BY_NODE = {
    "class_declaration": "class",
    "struct_declaration": "struct",
    "interface_declaration": "interface",
    "record_declaration": "record",
    "record_struct_declaration": "record",
    "enum_declaration": "enum",
}

# Parsers are not thread-safe and cheap to keep: one per process.
_PARSER = tree_sitter.Parser(CSHARP)


# --------------------------------------------------------------------------
# C#-specific payload
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CsExpr:
    """A receiver expression, reduced to what typing it needs.

    kind: `this` | `base` | `name` (identifier) | `member` (inner.name) |
    `call` (inner.name(arity); inner None for a bare call) | `new`
    (type_text) | `cast` (type_text; also `as`) | `await` (inner) |
    `index` (inner[...]) | `elem` (element type of inner, from `foreach`) |
    `literal` (type_text) | `typeof` | `unknown`.
    """

    kind: str
    name: str = ""
    inner: CsExpr | None = None
    arity: int = 0
    type_text: str = ""
    type_args: tuple[str, ...] = ()


UNKNOWN = CsExpr("unknown")


@dataclass(slots=True)
class CsCall:
    """One call site. `kind` is `call`, `new` (object creation; `type_text` is
    the created type) or `init` (a constructor initializer, `name` is `base`
    or `this`)."""

    receiver: CsExpr | None
    name: str
    arity: int
    lineno: int
    kind: str = "call"
    type_text: str = ""
    type_args: tuple[str, ...] = ()
    """Explicit generic arguments at the call (`Foo<int>()` -> `("int",)`)."""
    args: tuple[CsExpr, ...] | None = ()
    """Each argument reduced to a `CsExpr`, for overload filtering. `None` when
    named arguments make positional matching unreliable."""


@dataclass(slots=True)
class CsLocal:
    """A name's evidence: a declared type, an initializer to infer from, or
    neither (`var x = <unknown>`, lambda parameter). A name declared twice with
    different evidence in one method collapses to unknown rather than guessing."""

    type_text: str | None = None
    init: CsExpr | None = None


@dataclass(slots=True)
class CsParam:
    name: str
    type_text: str
    has_default: bool = False
    is_params: bool = False
    is_this: bool = False


@dataclass
class CsMethodData:
    kind: str = "method"  # method | ctor | property | indexer | operator | top-level
    return_type: str | None = None
    params: list[CsParam] = field(default_factory=list)
    type_params: frozenset[str] = frozenset()
    generic_names: tuple[str, ...] = ()
    constraints: dict[str, tuple[str, ...]] = field(default_factory=dict)
    """The method's *own* generic parameters in order (`Foo<T, U>` -> ("T", "U"))."""
    is_static: bool = False
    is_override: bool = False
    is_abstract: bool = False
    calls: list[CsCall] = field(default_factory=list)
    locals: dict[str, CsLocal] = field(default_factory=dict)
    local_functions: set[str] = field(default_factory=set)

    @property
    def generic_arity(self) -> int:
        return len(self.generic_names)

    @property
    def is_extension(self) -> bool:
        return bool(self.params) and self.params[0].is_this

    @property
    def min_arity(self) -> int:
        return sum(1 for p in self.params if not p.has_default and not p.is_params)

    @property
    def max_arity(self) -> int | None:
        """`None` when a `params` array makes it unbounded."""
        if any(p.is_params for p in self.params):
            return None
        return len(self.params)


@dataclass(frozen=True)
class CsUsing:
    kind: str  # namespace | static | alias
    target: str
    alias: str | None = None
    is_global: bool = False
    lineno: int = 0


@dataclass
class CsClassData:
    kind: str  # class | struct | interface | record | enum
    namespace: str = ""
    bases: list[str] = field(default_factory=list)
    members: dict[str, str] = field(default_factory=dict)
    """Field / property / enum-member / record-parameter name -> declared type."""
    type_params: frozenset[str] = frozenset()
    own_type_params: tuple[str, ...] = ()
    """Generic parameters declared by this type itself (not its outer types): its arity."""
    constraints: dict[str, tuple[str, ...]] = field(default_factory=dict)
    """`where T : A, B` -> {"T": ("A", "B")}, including enclosing types' parameters."""
    is_partial: bool = False
    is_static: bool = False
    usings: tuple[CsUsing, ...] = ()
    """`using` directives in effect for this type (file level plus those of every
    enclosing namespace block)."""
    init_data: CsMethodData = field(default_factory=lambda: CsMethodData(kind="init"))
    """Calls made by field/property initializers; attributed to the class."""
    primary_params: list[CsParam] = field(default_factory=list)


@dataclass
class CsModuleData:
    global_usings: list[CsUsing] = field(default_factory=list)
    top_level: CsMethodData | None = None
    """Top-level statements (`Program.cs` without a class), attributed to the file."""
    has_syntax_error: bool = False


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def _text(node: Node | None) -> str:
    return node.text.decode("utf-8", "ignore") if node is not None else ""


def _line(node: Node) -> int:
    return node.start_point[0] + 1


def _end_line(node: Node) -> int:
    return node.end_point[0] + 1


def _modifiers(node: Node) -> set[str]:
    return {_text(c) for c in node.children if c.type == "modifier"}


def _has_attributes(node: Node) -> bool:
    return any(c.type == "attribute_list" for c in node.children)


def _constraints(node: Node) -> dict[str, tuple[str, ...]]:
    """`where T : Base, IFoo<U>, new()` clauses declared directly on `node`."""
    out: dict[str, tuple[str, ...]] = {}
    for c in node.children:
        if c.type != "type_parameter_constraints_clause":
            continue
        target = next((x for x in c.named_children if x.type == "identifier"), None)
        if target is None:
            continue
        types = []
        for tc in c.named_children:
            if tc.type != "type_parameter_constraint":
                continue
            t = tc.child_by_field_name("type")
            if t is not None:
                types.append(_text(t))
        out[_text(target)] = tuple(types)
    return out


def _type_param_list(node: Node | None) -> tuple[str, ...]:
    if node is None:
        return ()
    return tuple(
        _text(p.child_by_field_name("name"))
        for p in node.named_children
        if p.type == "type_parameter"
    )


def _type_param_names(node: Node | None) -> frozenset[str]:
    if node is None:
        return frozenset()
    return frozenset(
        _text(p.child_by_field_name("name"))
        for p in node.named_children
        if p.type == "type_parameter"
    )


def _arg_count(call_node: Node) -> int:
    args = call_node.child_by_field_name("arguments")
    if args is None:
        return 0
    return sum(1 for c in args.named_children if c.type == "argument")


_LITERAL_TYPES = {
    "string_literal": "string",
    "verbatim_string_literal": "string",
    "raw_string_literal": "string",
    "interpolated_string_expression": "string",
    "character_literal": "char",
    "integer_literal": "int",
    "real_literal": "double",
    "boolean_literal": "bool",
    "null_literal": "null",
}


def _literal_type(node: Node) -> str:
    base = _LITERAL_TYPES[node.type]
    if node.type not in ("integer_literal", "real_literal"):
        return base
    text = _text(node).lower().replace("_", "")
    if node.type == "integer_literal":
        if text.endswith("ul") or text.endswith("lu"):
            return "ulong"
        if text.endswith("u"):
            return "uint"
        if text.endswith("l"):
            return "long"
        return "int"
    if text.endswith("f"):
        return "float"
    if text.endswith("m"):
        return "decimal"
    return "double"


def _generic_args(node: Node | None) -> tuple[str, ...]:
    """`Foo<int, string>` (a `generic_name`) -> ("int", "string"); anything else -> ()."""
    if node is None or node.type != "generic_name":
        return ()
    targs = next((c for c in node.children if c.type == "type_argument_list"), None)
    return tuple(_text(c) for c in targs.named_children) if targs is not None else ()


_ARG_DEPTH = 9
"""Arguments start describing at this depth (limit 12): only a few receiver links of an
argument are ever needed to pick an overload, and any nested call is its own call site."""


def _describe_args(call_node: Node) -> tuple[CsExpr, ...] | None:
    args = (
        call_node
        if call_node.type == "argument_list"
        else call_node.child_by_field_name("arguments")
    )
    if args is None:
        return ()
    out: list[CsExpr] = []
    for a in args.named_children:
        if a.type != "argument":
            continue
        if any(c.type == ":" for c in a.children):
            # `name: value` -- named arguments may be reordered, so positions no longer
            # line up with parameters and overloads cannot be filtered by argument type.
            return None
        value = a.named_children[-1] if a.named_children else None
        out.append(describe(value, _ARG_DEPTH))
    return tuple(out)


def _simple_name(node: Node | None) -> str:
    """The identifier of an `identifier` / `generic_name` (generic args dropped)."""
    if node is None:
        return ""
    if node.type == "generic_name":
        ident = next((c for c in node.children if c.type == "identifier"), None)
        return _text(ident)
    return _text(node)


def describe(node: Node | None, depth: int = 0) -> CsExpr:
    """Reduce an expression to a `CsExpr` (see its docstring). Receiver chains deeper
    than a dozen links are not worth following."""
    if node is None or depth > 12:
        return UNKNOWN
    t = node.type
    if t == "identifier":
        return CsExpr("name", name=_text(node))
    if t == "generic_name":
        return CsExpr("name", name=_simple_name(node), type_args=_generic_args(node))
    if t in ("this_expression", "this"):
        return CsExpr("this")
    if t in ("base_expression", "base"):
        return CsExpr("base")
    if t == "parenthesized_expression":
        return describe(node.named_children[0], depth + 1) if node.named_children else UNKNOWN
    if t in ("postfix_unary_expression", "checked_expression"):
        return describe(node.named_children[0], depth + 1) if node.named_children else UNKNOWN
    if t == "member_access_expression":
        name_node = node.child_by_field_name("name")
        name = _simple_name(name_node)
        recv = node.child_by_field_name("expression")
        if recv is None:
            # `this.X` / `base.X`: the receiver keyword is an anonymous token.
            first = node.children[0].type if node.children else ""
            inner = CsExpr(first) if first in ("this", "base") else UNKNOWN
        else:
            inner = describe(recv, depth + 1)
        return CsExpr("member", name=name, inner=inner, type_args=_generic_args(name_node))
    if t == "invocation_expression":
        return _describe_invocation(node, depth)
    if t == "object_creation_expression":
        return CsExpr("new", type_text=_text(node.child_by_field_name("type")))
    if t in ("cast_expression",):
        return CsExpr("cast", type_text=_text(node.child_by_field_name("type")))
    if t == "as_expression":
        return CsExpr("cast", type_text=_text(node.child_by_field_name("right")))
    if t == "await_expression":
        return CsExpr(
            "await",
            inner=describe(node.named_children[0], depth + 1) if node.named_children else None,
        )
    if t == "element_access_expression":
        return CsExpr("index", inner=describe(node.child_by_field_name("expression"), depth + 1))
    if t == "typeof_expression":
        return CsExpr("typeof")
    if t == "conditional_access_expression":
        return _describe_conditional(node, depth)
    if t in ("qualified_name", "alias_qualified_name"):
        return _describe_qualified(node, depth)
    if t in _LITERAL_TYPES:
        return CsExpr("literal", type_text=_literal_type(node))
    if t == "predefined_type":  # `string.IsNullOrEmpty(...)`, `int.Parse(...)`
        return CsExpr("predef", type_text=_text(node))
    return UNKNOWN


def _describe_qualified(node: Node, depth: int = 0) -> CsExpr:
    if node.type == "alias_qualified_name":  # global::System
        return CsExpr("name", name=_text(node.child_by_field_name("name")))
    left = node.child_by_field_name("qualifier")
    name_node = node.child_by_field_name("name")
    name = _simple_name(name_node)
    return CsExpr(
        "member", name=name, inner=describe(left, depth + 1), type_args=_generic_args(name_node)
    )


def _describe_conditional(node: Node, depth: int = 0) -> CsExpr:
    """`a?.b`, `a?.B()`, `a?.b?.C()`: the receiver chain with `?.` read as `.`."""
    cond = describe(node.child_by_field_name("condition"), depth + 1)
    rest = next(
        (c for c in reversed(node.children) if c.is_named and c.id != _field_id(node, "condition")),
        None,
    )
    if rest is None:
        return UNKNOWN
    if rest.type == "member_binding_expression":
        return CsExpr("member", name=_simple_name(rest.child_by_field_name("name")), inner=cond)
    if rest.type == "element_binding_expression":
        return CsExpr("index", inner=cond)
    if rest.type == "invocation_expression":
        fn = rest.child_by_field_name("function")
        if fn is not None and fn.type == "member_binding_expression":
            return CsExpr(
                "call",
                name=_simple_name(fn.child_by_field_name("name")),
                inner=cond,
                arity=_arg_count(rest),
            )
    return UNKNOWN


def _field_id(node: Node, field_name: str) -> int | None:
    child = node.child_by_field_name(field_name)
    return child.id if child is not None else None


def _describe_invocation(node: Node, depth: int = 0) -> CsExpr:
    call = _call_from_invocation(node, depth + 1, with_args=False)
    if call is None:
        return UNKNOWN
    return CsExpr(
        "call",
        name=call.name,
        inner=call.receiver,
        arity=call.arity,
        type_args=call.type_args,
    )


def _call_from_invocation(node: Node, depth: int = 0, *, with_args: bool = True) -> CsCall | None:
    """An `invocation_expression` as a `CsCall`, or None for non-calls
    (`nameof(x)`, invoking a call result, etc.)."""
    fn = node.child_by_field_name("function")
    if fn is None:
        return None
    arity = _arg_count(node)
    line = _line(node)
    t = fn.type
    if t in ("identifier", "generic_name"):
        name = _simple_name(fn)
        if name == "nameof":
            return None
        return CsCall(
            receiver=None,
            name=name,
            arity=arity,
            lineno=line,
            type_args=_generic_args(fn),
            args=_describe_args(node) if with_args else (),
        )
    if t == "member_access_expression":
        recv_node = fn.child_by_field_name("expression")
        name_node = fn.child_by_field_name("name")
        name = _simple_name(name_node)
        if recv_node is None:
            first = fn.children[0].type if fn.children else ""
            recv = CsExpr(first) if first in ("this", "base") else UNKNOWN
        else:
            recv = describe(recv_node, depth + 1)
        return CsCall(
            receiver=recv,
            name=name,
            arity=arity,
            lineno=line,
            type_args=_generic_args(name_node),
            args=_describe_args(node) if with_args else (),
        )
    if t == "conditional_access_expression":
        return _conditional_call(fn, node, arity, line, depth + 1, with_args)
    return None


def _conditional_call(
    fn: Node, node: Node, arity: int, line: int, depth: int = 0, with_args: bool = True
) -> CsCall | None:
    """`a?.B(...)` / `a?.b?.C(...)` where `fn` is the conditional access that
    is the invoked function: its last binding is the method name."""
    rest = next(
        (c for c in reversed(fn.children) if c.is_named and c.id != _field_id(fn, "condition")),
        None,
    )
    if rest is None or rest.type != "member_binding_expression":
        return None
    recv = describe(fn.child_by_field_name("condition"), depth)
    return CsCall(
        receiver=recv,
        name=_simple_name(rest.child_by_field_name("name")),
        arity=arity,
        lineno=line,
        type_args=_generic_args(rest.child_by_field_name("name")),
        args=_describe_args(node) if with_args else (),
    )


# --------------------------------------------------------------------------
# body collection (calls, locals)
# --------------------------------------------------------------------------


def _add_local(md: CsMethodData, name: str, type_text: str | None, init: CsExpr | None) -> None:
    if not name:
        return
    new = CsLocal(type_text=type_text, init=init)
    old = md.locals.get(name)
    if old is None:
        md.locals[name] = new
    elif old != new:
        md.locals[name] = CsLocal()  # conflicting evidence: unknown, never a guess


def _add_param(md: CsMethodData, param: Node) -> None:
    name = _text(param.child_by_field_name("name"))
    type_node = param.child_by_field_name("type")
    type_text = _text(type_node) if type_node is not None else None
    if type_text == "var":
        type_text = None
    _add_local(md, name, type_text, None)


def _parse_params(parameter_list: Node | None) -> list[CsParam]:
    if parameter_list is None:
        return []
    params: list[CsParam] = []
    for p in parameter_list.named_children:
        if p.type != "parameter":
            continue
        mods = {_text(c) for c in p.children if c.type == "modifier" or not c.is_named}
        has_default = any(c.type == "equals_value_clause" for c in p.children) or any(
            c.is_named
            and c.type not in ("modifier", "attribute_list", "identifier", "parameter_modifier")
            and c.id not in {_field_id(p, "type"), _field_id(p, "name")}
            for c in p.children
        )
        params.append(
            CsParam(
                name=_text(p.child_by_field_name("name")),
                type_text=_text(p.child_by_field_name("type")),
                has_default=has_default,
                is_params="params" in mods,
                is_this="this" in mods,
            )
        )
    # In this grammar a `params T[] name` parameter is not a `parameter` node: its
    # type/name fields sit directly on the parameter list.
    direct_type = parameter_list.child_by_field_name("type")
    if direct_type is not None:
        params.append(
            CsParam(
                name=_text(parameter_list.child_by_field_name("name")),
                type_text=_text(direct_type),
                is_params=True,
            )
        )
    return params


_COLLECT_QUERY = tree_sitter.Query(
    CSHARP,
    """
    (invocation_expression) @call
    (object_creation_expression) @new
    (variable_declaration) @vdecl
    (declaration_pattern) @dpat
    (catch_declaration) @catch
    (foreach_statement) @foreach
    (declaration_expression) @dexpr
    (parameter) @param
    (implicit_parameter) @iparam
    (local_function_statement) @localfn
    """,
)


def _lambda_parameter_evidence(param: Node) -> CsExpr | None:
    """For `items.Where(x => ...)`: the first lambda parameter `x` takes the element type
    of `items`. Recorded as a `lambda_elem` expression (the method name and the receiver);
    the resolver decides, from the method name, whether the parameter really is the
    element. None when the lambda is not directly an argument of a method call."""
    lam = param.parent
    if lam is not None and lam.type == "parameter_list":
        if not lam.named_children or lam.named_children[0].id != param.id:
            return None  # only the first of `(x, y) => ...`
        lam = lam.parent
    if lam is None or lam.type != "lambda_expression":
        return None
    arg = lam.parent
    if arg is None or arg.type != "argument":
        return None
    arg_list = arg.parent
    call = arg_list.parent if arg_list is not None else None
    if call is None or call.type != "invocation_expression":
        return None
    fn = call.child_by_field_name("function")
    if fn is None or fn.type != "member_access_expression":
        return None
    receiver = fn.child_by_field_name("expression")
    if receiver is None:
        return None
    return CsExpr(
        "lambda_elem", name=_simple_name(fn.child_by_field_name("name")), inner=describe(receiver)
    )


def _document_order(nodes: list[Node]) -> list[Node]:
    """Source order, enclosing expressions before the ones nested in them (the order a
    compiler's syntax walk visits them). Query results do not promise this order."""
    return sorted(nodes, key=lambda n: (n.start_byte, -n.end_byte))


def _collect(root: Node, md: CsMethodData) -> None:
    """Every call site under `root`, plus the type evidence of every local-ish
    declaration. Lambdas and local functions are covered in place, so their calls
    belong to the enclosing method.

    A tree-sitter query does the traversal in native code and hands back only the
    handful of node kinds that matter; walking every node from Python was the
    dominant extraction cost on large repositories."""
    caps = tree_sitter.QueryCursor(_COLLECT_QUERY).captures(root)
    for n in _document_order(caps.get("call", ())):
        call = _call_from_invocation(n)
        if call is not None:
            md.calls.append(call)
    for n in _document_order(caps.get("new", ())):
        md.calls.append(
            CsCall(
                receiver=None,
                name=".ctor",
                arity=_arg_count(n),
                lineno=_line(n),
                kind="new",
                type_text=_text(n.child_by_field_name("type")),
                args=_describe_args(n),
            )
        )
    for n in caps.get("vdecl", ()):
        type_node = n.child_by_field_name("type")
        type_text = _text(type_node) if type_node is not None else None
        implicit = type_node is not None and type_node.type == "implicit_type"
        for d in n.named_children:
            if d.type != "variable_declarator":
                continue
            name = _text(
                d.child_by_field_name("name") or (d.named_children[0] if d.named_children else None)
            )
            if implicit:
                _add_local(md, name, None, _declarator_init(d))
            else:
                _add_local(md, name, type_text, None)
    for n in caps.get("dpat", ()):
        _add_local(
            md, _text(n.child_by_field_name("name")), _text(n.child_by_field_name("type")), None
        )
    for n in caps.get("catch", ()):
        _add_local(
            md, _text(n.child_by_field_name("name")), _text(n.child_by_field_name("type")), None
        )
    for n in caps.get("foreach", ()):
        type_node = n.child_by_field_name("type")
        left = n.child_by_field_name("left")
        name = _text(left) if left is not None and left.type == "identifier" else ""
        if type_node is not None and type_node.type == "implicit_type":
            _add_local(
                md, name, None, CsExpr("elem", inner=describe(n.child_by_field_name("right")))
            )
        else:
            _add_local(md, name, _text(type_node), None)
    for n in caps.get("dexpr", ()):  # `out var x` / `out Foo x`
        type_node = n.child_by_field_name("type")
        name = _text(n.child_by_field_name("name"))
        if type_node is not None and type_node.type == "implicit_type":
            _add_local(md, name, None, None)
        else:
            _add_local(md, name, _text(type_node), None)
    for n in caps.get("param", ()):  # lambda / local-function parameters
        _add_param(md, n)
    for n in caps.get("iparam", ()):  # `x => ...`
        _add_local(md, _text(n), None, _lambda_parameter_evidence(n))
    for n in caps.get("localfn", ()):
        md.local_functions.add(_text(n.child_by_field_name("name")))


def _declarator_init(declarator: Node) -> CsExpr | None:
    for c in declarator.named_children:
        if c.type == "equals_value_clause":
            return describe(c.named_children[0]) if c.named_children else None
        if c.type not in ("identifier", "bracketed_argument_list"):
            return describe(c)
    return None


# --------------------------------------------------------------------------
# members
# --------------------------------------------------------------------------


def _method_data(node: Node, kind: str, class_type_params: frozenset[str]) -> CsMethodData:
    mods = _modifiers(node)
    md = CsMethodData(
        kind=kind,
        return_type=_text(node.child_by_field_name("returns") or node.child_by_field_name("type"))
        or None,
        params=_parse_params(node.child_by_field_name("parameters")),
        type_params=class_type_params
        | _type_param_names(node.child_by_field_name("type_parameters")),
        generic_names=_type_param_list(node.child_by_field_name("type_parameters")),
        constraints=_constraints(node),
        is_static="static" in mods,
        is_override="override" in mods,
        is_abstract="abstract" in mods,
    )
    for p in md.params:
        _add_local(md, p.name, p.type_text or None, None)
    return md


def _raw_function(
    node: Node,
    name: str,
    md: CsMethodData,
    *,
    accessor: str | None = None,
    implicit_invocation: bool = False,
) -> RawFunction:
    return RawFunction(
        name=name,
        lineno=_line(node),
        end_lineno=_end_line(node),
        accessor_kind=accessor,  # type: ignore[arg-type]
        has_decorators=_has_attributes(node) or implicit_invocation or md.is_override,
        lang_data=md,
    )


def _body_of(node: Node) -> Node | None:
    """Method/accessor body: a block, or an expression body (`=> expr`)."""
    body = node.child_by_field_name("body")
    if body is not None:
        return body
    for c in node.children:
        if c.type == "arrow_expression_clause":
            return c
    return None


def _extract_accessors(node: Node, name: str, base: CsMethodData) -> list[RawFunction]:
    """Property/indexer accessors that actually contain code. Auto-accessors
    (`get; set;`) have no body and make no graph node: the property is a member,
    not a function. Accessors are invoked implicitly by every property access,
    which the call graph does not model, so they are flagged like framework-invoked
    methods to keep dead-code analysis from reporting them."""
    functions: list[RawFunction] = []
    accessors = node.child_by_field_name("accessors")
    arrow = next((c for c in node.children if c.type == "arrow_expression_clause"), None)
    if arrow is None:
        value = node.child_by_field_name("value")
        arrow = value if value is not None and value.type == "arrow_expression_clause" else None
    if arrow is not None:
        md = CsMethodData(
            kind=base.kind,
            return_type=base.return_type,
            params=base.params,
            type_params=base.type_params,
            is_static=base.is_static,
        )
        md.locals = dict(base.locals)
        _collect(arrow, md)
        functions.append(_raw_function(node, name, md, accessor="get", implicit_invocation=True))
    if accessors is not None:
        for acc in accessors.named_children:
            if acc.type != "accessor_declaration":
                continue
            kw = next((c.type for c in acc.children if c.type in ("get", "set", "init")), None)
            body = _body_of(acc)
            if kw is None or body is None:
                continue
            md = CsMethodData(
                kind=base.kind,
                return_type=base.return_type,
                params=base.params,
                type_params=base.type_params,
                is_static=base.is_static,
            )
            md.locals = dict(base.locals)
            _collect(body, md)
            functions.append(
                _raw_function(
                    acc,
                    name,
                    md,
                    accessor="get" if kw == "get" else "set",
                    implicit_invocation=True,
                )
            )
    return functions


def _assign_overload_indices(methods: list[RawFunction]) -> None:
    """Same collision-avoidance as Java's: same-named methods/constructors in one
    class get a stable 1-based index so each keeps its own graph node. Properties
    are keyed by (name, accessor) so a get/set pair stays distinct without an index."""
    counts: dict[tuple[str, str | None], int] = {}
    for m in methods:
        key = (m.name, m.accessor_kind)
        counts[key] = counts.get(key, 0) + 1
    seen: dict[tuple[str, str | None], int] = {}
    for m in methods:
        key = (m.name, m.accessor_kind)
        if counts[key] > 1:
            seen[key] = seen.get(key, 0) + 1
            m.overload_index = seen[key]


def operator_label(node: Node) -> str:
    """Graph label of an operator or conversion operator: `operator +`, `operator implicit`."""
    op = next((c for c in node.children if c.type in ("operator", "implicit", "explicit")), None)
    return "operator " + (_text(node.child_by_field_name("operator")) or _text(op) or "?")


def _extract_type(
    node: Node,
    namespace: str,
    usings: tuple[CsUsing, ...],
    outer_type_params: frozenset[str],
    outer_constraints: dict[str, tuple[str, ...]] | None = None,
) -> RawClass:
    name = _text(node.child_by_field_name("name")) or "<anonymous>"
    kind = _KIND_BY_NODE[node.type]
    mods = _modifiers(node)
    type_params = outer_type_params | _type_param_names(
        next((c for c in node.children if c.type == "type_parameter_list"), None)
    )
    own_params = _type_param_list(
        next((c for c in node.children if c.type == "type_parameter_list"), None)
    )
    data = CsClassData(
        kind=kind,
        namespace=namespace,
        type_params=type_params,
        own_type_params=own_params,
        constraints={**(outer_constraints or {}), **_constraints(node)},
        is_partial="partial" in mods,
        is_static="static" in mods,
        usings=usings,
    )
    for c in node.children:
        if c.type == "base_list":
            data.bases = [_text(b) for b in c.named_children if b.type != "argument_list"]
        elif c.type == "parameter_list":  # record / primary constructor
            data.primary_params = _parse_params(c)
            for p in data.primary_params:
                data.members[p.name] = p.type_text
    methods: list[RawFunction] = []
    attributes: list[RawVariable] = []
    nested: list[RawClass] = []

    body = node.child_by_field_name("body")
    members = body.named_children if body is not None else []
    for m in members:
        t = m.type
        if t == "method_declaration":
            md = _method_data(m, "method", type_params)
            b = _body_of(m)
            if b is not None:
                _collect(b, md)
            methods.append(_raw_function(m, _text(m.child_by_field_name("name")), md))
        elif t == "constructor_declaration":
            md = _method_data(m, "ctor", type_params)
            md.return_type = None
            init = next((c for c in m.children if c.type == "constructor_initializer"), None)
            if init is not None:
                which = next((c.type for c in init.children if c.type in ("base", "this")), "base")
                args = next((c for c in init.named_children if c.type == "argument_list"), None)
                md.calls.append(
                    CsCall(
                        receiver=None,
                        name=which,
                        arity=sum(1 for a in args.named_children if a.type == "argument")
                        if args
                        else 0,
                        lineno=_line(init),
                        kind="init",
                        args=_describe_args(args) if args is not None else (),
                    )
                )
                _collect(init, md)
            b = _body_of(m)
            if b is not None:
                _collect(b, md)
            methods.append(_raw_function(m, name, md))
        elif t in ("operator_declaration", "conversion_operator_declaration"):
            md = _method_data(m, "operator", type_params)
            b = _body_of(m)
            if b is not None:
                _collect(b, md)
            methods.append(_raw_function(m, operator_label(m), md, implicit_invocation=True))
        elif t in ("property_declaration", "indexer_declaration"):
            pname = "this[]" if t == "indexer_declaration" else _text(m.child_by_field_name("name"))
            ptype = _text(m.child_by_field_name("type"))
            if t == "property_declaration":
                data.members[pname] = ptype
            base = CsMethodData(
                kind="property" if t == "property_declaration" else "indexer",
                return_type=ptype,
                params=_parse_params(m.child_by_field_name("parameters")),
                type_params=type_params,
                is_static="static" in _modifiers(m),
            )
            methods.extend(_extract_accessors(m, pname, base))
            value = m.child_by_field_name("value")
            if value is not None and value.type == "equals_value_clause":
                _collect(value, data.init_data)
            if t == "property_declaration":
                attributes.append(RawVariable(name=pname, lineno=_line(m), annotation=ptype))
        elif t in ("field_declaration", "event_field_declaration"):
            vd = next((c for c in m.children if c.type == "variable_declaration"), None)
            if vd is None:
                continue
            ftype = _text(vd.child_by_field_name("type"))
            for d in vd.named_children:
                if d.type != "variable_declarator":
                    continue
                fname = _text(
                    d.child_by_field_name("name")
                    or (d.named_children[0] if d.named_children else None)
                )
                if not fname:
                    continue
                data.members[fname] = ftype
                attributes.append(RawVariable(name=fname, lineno=_line(d), annotation=ftype))
                _collect(d, data.init_data)
        elif t == "enum_member_declaration":
            ename = _text(m.child_by_field_name("name"))
            if ename:
                data.members[ename] = name
                attributes.append(RawVariable(name=ename, lineno=_line(m), annotation=name))
        elif t in TYPE_DECLARATION_TYPES:
            nested.append(_extract_type(m, namespace, usings, type_params, data.constraints))

    _assign_overload_indices(methods)
    _disambiguate_siblings(nested)
    return RawClass(
        name=name,
        lineno=_line(node),
        end_lineno=_end_line(node),
        methods=methods,
        attributes=attributes,
        nested_classes=nested,
        lang_data=data,
    )


# --------------------------------------------------------------------------
# module level
# --------------------------------------------------------------------------


def _parse_using(node: Node) -> CsUsing | None:
    is_global = any(c.type == "global" for c in node.children) or _text(node).lstrip().startswith(
        "global"
    )
    is_static = any(c.type == "static" for c in node.children)
    alias = node.child_by_field_name("name")
    target = next(
        (
            c
            for c in node.named_children
            if c.type in ("identifier", "qualified_name", "alias_qualified_name", "generic_name")
            and (alias is None or c.id != alias.id)
        ),
        None,
    )
    if target is None:
        return None
    text = _text(target)
    if text.startswith("global::"):
        text = text[len("global::") :]
    if alias is not None:
        return CsUsing("alias", text, alias=_text(alias), is_global=is_global, lineno=_line(node))
    return CsUsing(
        "static" if is_static else "namespace", text, is_global=is_global, lineno=_line(node)
    )


def _walk_scope(
    children: list[Node],
    namespace: str,
    usings: tuple[CsUsing, ...],
    module: RawModule,
    data: CsModuleData,
) -> None:
    """Members of the compilation unit or one namespace block. A file-scoped
    namespace (`namespace A.B;`) applies to the *siblings after it*, which is
    why this tracks the namespace as mutable state while iterating."""
    local_usings = list(usings)
    # Usings of this scope precede its types in practice; collect first so a
    # type declared above a (misplaced) using still sees it.
    for c in children:
        if c.type == "using_directive":
            u = _parse_using(c)
            if u is not None:
                if u.is_global:
                    data.global_usings.append(u)
                local_usings.append(u)
                module.imports.append(_to_raw_import(u))
    scope_usings = tuple(local_usings)
    current_ns = namespace
    for c in children:
        t = c.type
        if t == "namespace_declaration":
            ns_name = _text(c.child_by_field_name("name"))
            full = f"{current_ns}.{ns_name}" if current_ns else ns_name
            body = c.child_by_field_name("body")
            _walk_scope(
                body.named_children if body is not None else [], full, scope_usings, module, data
            )
        elif t == "file_scoped_namespace_declaration":
            ns_name = _text(c.child_by_field_name("name"))
            current_ns = f"{namespace}.{ns_name}" if namespace else ns_name
        elif t in TYPE_DECLARATION_TYPES:
            module.classes.append(_extract_type(c, current_ns, scope_usings, frozenset()))
        elif t == "global_statement":
            if data.top_level is None:
                data.top_level = CsMethodData(kind="top-level")
            _collect(c, data.top_level)


def _to_raw_import(u: CsUsing) -> RawImport:
    """`using A.B.C;` -> module `A.B`, name `C`; level 1 = `using static`,
    level 2 = `global using` marker is carried on the CsUsing, not here."""
    module, _, name = u.target.rpartition(".")
    return RawImport(
        module=module or None,
        name=name or u.target,
        asname=u.alias,
        level=1 if u.kind == "static" else 0,
        lineno=u.lineno,
    )


def _disambiguate_siblings(classes: list[RawClass]) -> None:
    """Same-named sibling types that differ only in generic arity (`Table<T>` and
    `Table<T, TId>`) would share one graph node id, one silently replacing the other.
    The generic ones are renamed CLR-style (`Table`2`); a non-generic sibling and
    partial declarations of one type keep the plain name."""
    by_name: dict[str, list[RawClass]] = {}
    for c in classes:
        by_name.setdefault(c.name, []).append(c)
    for name, group in by_name.items():
        arities = {len(c.lang_data.own_type_params) for c in group if c.lang_data is not None}
        if len(arities) < 2:
            continue
        for c in group:
            n = len(c.lang_data.own_type_params) if c.lang_data is not None else 0
            if n:
                c.name = f"{name}`{n}"


_DIRECTIVE = re.compile(r"^\s*#\s*(if|elif|else|endif)\b(.*)$")
_TOKEN = re.compile(r"\s*(\|\||&&|!|\(|\)|[A-Za-z_][A-Za-z0-9_]*)")

# Symbols a modern multi-target build defines (so `#if NET6_0_OR_GREATER` code is
# analysed) versus legacy-framework symbols it does not (`#if NET20` shims).
_MODERN = re.compile(
    r"^(NET(CORE|STANDARD|FRAMEWORK)?(\d+(_\d+)?)?_OR_GREATER|NET|NETCOREAPP|NETSTANDARD"
    r"|NETSTANDARD2_[01]|NET[5-9]_0|NETCOREAPP3_[01]|TRACE|true)$"
)
_LEGACY = re.compile(
    r"^(NET\d{2,3}|NET4\d+|PORTABLE\d*|SILVERLIGHT|WINDOWS_PHONE\w*|WINDOWS_UWP|UNITY\w*|MONO|"
    r"DEBUG|false|DNXCORE50|NETFX\w*|CLR\w*)$"
)


def _symbol_defined(name: str) -> bool:
    if _MODERN.match(name):
        return True
    if _LEGACY.match(name):
        return False
    return True  # project-specific feature flags (`HAVE_ASYNC`): analyse the code they enable


def _eval_condition(expr: str) -> bool:
    """`!(NET20 || PORTABLE) && HAVE_X` under the symbol policy above. Unparseable
    conditions count as true, so the code is kept rather than silently dropped."""
    expr = expr.split("//")[0]
    tokens = _TOKEN.findall(expr)
    pos = 0

    def peek() -> str | None:
        return tokens[pos] if pos < len(tokens) else None

    def parse_or() -> bool:
        nonlocal pos
        left = parse_and()
        while peek() == "||":
            pos += 1
            right = parse_and()
            left = left or right
        return left

    def parse_and() -> bool:
        nonlocal pos
        left = parse_not()
        while peek() == "&&":
            pos += 1
            right = parse_not()
            left = left and right
        return left

    def parse_not() -> bool:
        nonlocal pos
        if peek() == "!":
            pos += 1
            return not parse_not()
        return parse_atom()

    def parse_atom() -> bool:
        nonlocal pos
        tok = peek()
        if tok is None:
            raise ValueError("unexpected end")
        pos += 1
        if tok == "(":
            value = parse_or()
            if peek() == ")":
                pos += 1
            return value
        if tok in ("||", "&&", "!", ")"):
            raise ValueError(f"unexpected {tok}")
        return _symbol_defined(tok)

    try:
        return parse_or()
    except ValueError:
        return True


def strip_conditionals(source: str) -> str:
    """Resolve conditional compilation: keep the active branch of every
    `#if` / `#elif` / `#else` chain (see `_symbol_defined` for what counts as
    defined) and blank the others, preserving every line number.

    This runs *before* parsing because tree-sitter handles directives poorly:
    it either wraps whole declarations in preprocessor nodes the walker would
    have to special-case, or, when a branch splits a syntactic unit
    (`#if NET ... if (x) { #else ... if (y) { #endif`), sees both branches at
    once and gives up on the surrounding declaration. Both would silently drop
    types from the graph. What is lost is the inactive branch, usually another
    target framework's variant of the same code.
    """
    out: list[str] = []
    # per open `#if`: (parent_emitting, a_branch_was_taken)
    stack: list[tuple[bool, bool]] = []
    emitting = True
    for line in source.splitlines(keepends=True):
        m = _DIRECTIVE.match(line)
        if m is None:
            out.append(line if emitting else _blank(line))
            continue
        kind, rest = m.group(1), m.group(2)
        if kind == "if":
            value = _eval_condition(rest)
            stack.append((emitting, value))
            emitting = emitting and value
        elif kind == "elif" and stack:
            parent, taken = stack[-1]
            value = _eval_condition(rest)
            emitting = parent and not taken and value
            stack[-1] = (parent, taken or value)
        elif kind == "else" and stack:
            parent, taken = stack[-1]
            emitting = parent and not taken
            stack[-1] = (parent, True)
        elif kind == "endif" and stack:
            emitting = stack.pop()[0]
        out.append(_blank(line))
    return "".join(out)


def _blank(line: str) -> str:
    """The line's own terminator only, so line numbers are unchanged."""
    return line[len(line.rstrip("\r\n")) :]


# `async` used as an *identifier* (`bool async`, `Foo(async)`, `async ? a : b`). The published
# grammar mis-parses it and, in a file that uses it freely (EF Core's tests take a `bool async`
# parameter everywhere), loses the whole file's structure. As a modifier `async` is followed by
# a type, `delegate`, `(` or a lambda parameter; as an identifier by punctuation.
_ASYNC_AS_IDENTIFIER = re.compile(r"(?<![\w.@])async(?=\s*[,);.?:=\]}&|!+*/%-])(?!\s*=>)")


def neutralize_async_identifiers(source: str) -> str:
    """Rename `async`-as-identifier to a same-length, same-shaped name so the grammar can
    parse the file. Length-preserving, so no line or column moves; the name is never used."""
    if "async" not in source:
        return source
    return _ASYNC_AS_IDENTIFIER.sub("asyn_", source)


def parse_tree(source: str) -> tree_sitter.Tree:
    """Parse `source` with conditional compilation resolved and grammar blind spots
    (`async` as an identifier) worked around."""
    source = source.removeprefix("﻿")  # UTF-8 BOM
    if "#if" in source or "# if" in source:
        source = strip_conditionals(source)
    source = neutralize_async_identifiers(source)
    return _PARSER.parse(source.encode("utf-8"))


def _error_count(tree: tree_sitter.Tree) -> int:
    if not tree.root_node.has_error:
        return 0
    count = 0
    stack = [tree.root_node]
    while stack:
        n = stack.pop()
        if n.type == "ERROR" or n.is_missing:
            count += 1
        stack.extend(c for c in n.children if c.has_error)
    return count


def first_error_line(tree: tree_sitter.Tree) -> int | None:
    def _search(node: Node) -> int | None:
        if node.type == "ERROR" or node.is_missing:
            return _line(node)
        for child in node.children:
            if child.has_error:
                found = _search(child)
                if found is not None:
                    return found
        return None

    return _search(tree.root_node) if tree.root_node.has_error else None


def extract_module(tree: tree_sitter.Tree, rel_path: str) -> RawModule:
    module = RawModule(rel_path=rel_path)
    data = CsModuleData(has_syntax_error=tree.root_node.has_error)
    _walk_scope(tree.root_node.named_children, "", (), module, data)
    _disambiguate_siblings(module.classes)
    module.lang_data = data
    return module


def extract_csharp_module(source: str, rel_path: str = "A.cs") -> RawModule:
    """Parse and extract in one step (tests and direct callers)."""
    return extract_module(parse_tree(source), rel_path)
