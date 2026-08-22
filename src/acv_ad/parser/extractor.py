"""Per-file AST extraction into intermediate ("raw") structures.

This module only looks at a single module's syntax tree. It does not
resolve names across files -- that is the resolver's job. Keeping this
boundary means the extractor can be tested/reasoned about independent of
how imports and calls end up wired together.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field


@dataclass
class RawCall:
    dotted: str | None
    """Dotted callee expression, e.g. "os.path.join". `None` when the
    call target isn't a simple Name/Attribute chain (e.g. calling the
    result of another call, a subscript, or a lambda)."""
    lineno: int


@dataclass
class RawFunction:
    name: str
    lineno: int
    end_lineno: int
    calls: list[RawCall] = field(default_factory=list)
    decorator_calls: list[RawCall] = field(default_factory=list)
    """Calls made in this function/method's decorator expressions, e.g.
    `app.route(...)` in `@app.route("/x")`. These execute in the
    *enclosing* scope at definition time, not inside the function body,
    so callers must attribute them to that enclosing scope rather than
    to this function's own node."""
    nested_classes: list[RawClass] = field(default_factory=list)
    """Classes defined directly in this function's body."""


@dataclass
class RawClass:
    name: str
    lineno: int
    end_lineno: int
    methods: list[RawFunction] = field(default_factory=list)
    attributes: list[RawVariable] = field(default_factory=list)
    nested_classes: list[RawClass] = field(default_factory=list)
    """Classes defined in this class's body, including ones wrapped in
    `if`/`for`/`while`/`try`/`with`/`match` blocks."""
    decorator_calls: list[RawCall] = field(default_factory=list)
    """Calls made in this class's decorator expressions, e.g. a class
    decorator factory like `@register("thing")`. These run in the
    *enclosing* scope at class-definition time, not "inside" the class."""


@dataclass
class RawImport:
    module: str | None
    """Dotted module the name is imported from. `None` for plain
    `import x` statements, where `name` itself is the dotted module."""
    name: str
    """Imported name. For `import a.b.c` this is "a.b.c". For
    `from x import *` this is "*"."""
    asname: str | None
    level: int
    """Relative-import dot count (0 for absolute imports)."""
    lineno: int

    @property
    def is_star(self) -> bool:
        return self.name == "*"


@dataclass
class RawVariable:
    name: str
    lineno: int
    annotation: str | None = None


@dataclass
class RawModule:
    rel_path: str
    imports: list[RawImport] = field(default_factory=list)
    classes: list[RawClass] = field(default_factory=list)
    functions: list[RawFunction] = field(default_factory=list)
    variables: list[RawVariable] = field(default_factory=list)


def _dotted_name(expr: ast.expr) -> str | None:
    """Flatten a Name/Attribute chain (e.g. `os.path.join`) into a dotted
    string. Returns `None` for anything more dynamic (calls, subscripts,
    etc.) that cannot be statically resolved to a single reference."""
    parts: list[str] = []
    node: ast.expr = expr
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _annotation_to_str(annotation: ast.expr | None) -> str | None:
    if annotation is None:
        return None
    try:
        return ast.unparse(annotation)
    except Exception:
        return None


class _CallCollector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.calls: list[RawCall] = []

    def visit_Call(self, node: ast.Call) -> None:
        self.calls.append(RawCall(dotted=_dotted_name(node.func), lineno=node.lineno))
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        # Nested classes are extracted as their own symbols (see
        # `_extract_class`), so their bodies must not be flattened into
        # whatever scope is currently being collected -- otherwise calls
        # made inside a nested class's methods would be double-counted
        # against both the nested method and its enclosing scope.
        pass


def _collect_calls(stmts: list[ast.stmt]) -> list[RawCall]:
    """Collect every call made within `stmts`, including calls nested in
    loops, conditionals, comprehensions, and nested/inner function defs.
    Nested function defs are intentionally flattened into their enclosing
    named function/method rather than tracked as separate symbols; nested
    class defs are excluded here because they get their own symbols (see
    `_extract_class`/`nested_classes`).

    Decorator expressions, default-argument values, and return
    annotations are excluded on purpose: those evaluate in the *enclosing*
    scope at definition time, not inside the function body, so folding
    them in here would misattribute the call site.
    """
    collector = _CallCollector()
    for stmt in stmts:
        collector.visit(stmt)
    return collector.calls


def _collect_decorator_calls(decorator_list: list[ast.expr]) -> list[RawCall]:
    collector = _CallCollector()
    for decorator in decorator_list:
        collector.visit(decorator)
    return collector.calls


DefT = ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef


def _iter_scoped_defs(stmts: list[ast.stmt]) -> list[DefT]:
    """Finds every class/function def that executes directly *in this
    scope* -- including ones wrapped in `if`/`for`/`while`/`try`/`with`/
    `match` (none of those introduce a new Python scope) -- without
    descending into a nested def's own body, since that def is a
    different scope and gets walked separately when it is itself
    extracted. Without this, a class or function guarded by e.g. a
    `TYPE_CHECKING`/version `if`, or defined inside `try/except` (a
    common conditional-import pattern), would be silently missed.
    """
    found: list[DefT] = []
    for stmt in stmts:
        if isinstance(stmt, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            found.append(stmt)
        elif isinstance(stmt, (ast.If, ast.While)):
            found.extend(_iter_scoped_defs(stmt.body))
            found.extend(_iter_scoped_defs(stmt.orelse))
        elif isinstance(stmt, (ast.For, ast.AsyncFor)):
            found.extend(_iter_scoped_defs(stmt.body))
            found.extend(_iter_scoped_defs(stmt.orelse))
        elif isinstance(stmt, (ast.Try, ast.TryStar)):
            found.extend(_iter_scoped_defs(stmt.body))
            for handler in stmt.handlers:
                found.extend(_iter_scoped_defs(handler.body))
            found.extend(_iter_scoped_defs(stmt.orelse))
            found.extend(_iter_scoped_defs(stmt.finalbody))
        elif isinstance(stmt, (ast.With, ast.AsyncWith)):
            found.extend(_iter_scoped_defs(stmt.body))
        elif isinstance(stmt, ast.Match):
            for case in stmt.cases:
                found.extend(_iter_scoped_defs(case.body))
    return found


def _find_nested_classes(stmts: list[ast.stmt]) -> list[ast.ClassDef]:
    """Classes reachable from this scope, flattening through any number
    of nested function closures.

    Nested function defs are intentionally *not* tracked as their own
    symbols (their calls get flattened into the enclosing named
    function/method -- see `_collect_calls`), so nothing else ever
    revisits their bodies. A class defined inside such a closure -- at
    any depth, e.g. `def outer(): def inner(): class Deep: ...` -- would
    otherwise vanish with no node, no edge, and no trace at all. Classes
    themselves are never flattened like this: each one found here stops
    the walk and is returned as-is, to be extracted as its own symbol.
    """
    found: list[ast.ClassDef] = []
    for item in _iter_scoped_defs(stmts):
        if isinstance(item, ast.ClassDef):
            found.append(item)
        else:
            found.extend(_find_nested_classes(item.body))
    return found


FunctionDefT = ast.FunctionDef | ast.AsyncFunctionDef


def _extract_function(node: FunctionDefT) -> RawFunction:
    nested_classes = [_extract_class(item) for item in _find_nested_classes(node.body)]
    return RawFunction(
        name=node.name,
        lineno=node.lineno,
        end_lineno=node.end_lineno or node.lineno,
        calls=_collect_calls(node.body),
        decorator_calls=_collect_decorator_calls(node.decorator_list),
        nested_classes=nested_classes,
    )


def _extract_variables(stmts: list[ast.stmt]) -> list[RawVariable]:
    variables: list[RawVariable] = []
    for stmt in stmts:
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            variables.append(
                RawVariable(
                    name=stmt.target.id,
                    lineno=stmt.lineno,
                    annotation=_annotation_to_str(stmt.annotation),
                )
            )
        elif isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    variables.append(RawVariable(name=target.id, lineno=stmt.lineno))
    return variables


def _extract_class(node: ast.ClassDef) -> RawClass:
    scoped_defs = _iter_scoped_defs(node.body)
    methods = [
        _extract_function(item)
        for item in scoped_defs
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    nested_classes = [
        _extract_class(item) for item in scoped_defs if isinstance(item, ast.ClassDef)
    ]
    attributes = _extract_variables(node.body)
    return RawClass(
        name=node.name,
        lineno=node.lineno,
        end_lineno=node.end_lineno or node.lineno,
        methods=methods,
        attributes=attributes,
        nested_classes=nested_classes,
        decorator_calls=_collect_decorator_calls(node.decorator_list),
    )


def _extract_imports(node: ast.Import | ast.ImportFrom) -> list[RawImport]:
    if isinstance(node, ast.Import):
        return [
            RawImport(
                module=None, name=alias.name, asname=alias.asname, level=0, lineno=node.lineno
            )
            for alias in node.names
        ]
    return [
        RawImport(
            module=node.module,
            name=alias.name,
            asname=alias.asname,
            level=node.level,
            lineno=node.lineno,
        )
        for alias in node.names
    ]


def extract_module(tree: ast.Module, rel_path: str) -> RawModule:
    module = RawModule(rel_path=rel_path)
    for stmt in tree.body:
        if isinstance(stmt, (ast.Import, ast.ImportFrom)):
            module.imports.extend(_extract_imports(stmt))
        elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            module.variables.extend(_extract_variables([stmt]))

    # Classes/functions are discovered via `_iter_scoped_defs` (not a
    # direct top-level scan) so ones guarded by `if`/`try`/etc. at module
    # level -- e.g. a `TYPE_CHECKING` guard or a conditional-import
    # fallback function in `try/except` -- aren't silently missed.
    for item in _iter_scoped_defs(tree.body):
        if isinstance(item, ast.ClassDef):
            module.classes.append(_extract_class(item))
        else:
            module.functions.append(_extract_function(item))
    return module
