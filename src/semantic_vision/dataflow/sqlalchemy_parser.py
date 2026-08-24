"""SQLAlchemy declarative-model detection: an additive pass alongside the
existing Python class walk (`parser/extractor.py`), not a separate parser
or pipeline. Emits `Table` nodes (tagged `source="orm_model"`) and
`MAPS_TO`/`FOREIGN_KEY` edges from classes that look like SQLAlchemy
declarative models.

Deliberately conservative, matching this project's existing "skip rather
than guess" resolution philosophy: a model built on a differently-named
declarative base, a computed `__tablename__`, or a non-string-literal
`ForeignKey` target is silently not detected rather than misdetected.
`relationship(...)` targets are not parsed -- a declared `Column(...,
ForeignKey(...))` already gives an unambiguous table-level edge, and
resolving a `relationship()` target to a table name would require
tracking class-to-table mappings and backref/association-proxy
configurations well beyond what this slice needs.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass

from semantic_vision.models import Edge, EdgeKind, Node, NodeKind

_DECLARATIVE_BASE_NAMES = frozenset({"Base", "DeclarativeBase"})


def table_node_id(table_name: str) -> str:
    return f"table::{table_name}"


@dataclass
class SqlAlchemyResult:
    nodes: list[Node]
    edges: list[Edge]
    model_tables: dict[str, str]
    """Declarative model class name -> the `Table` node id it maps to
    (Milestone 17b consumes this to recognize `Model(...)`/`query(Model)`
    call-site usage as touching a known table). Repo-wide and name-only,
    like `tables` itself -- the last class seen with a given name wins on
    a same-named-class-in-two-files collision, an accepted heuristic
    limitation consistent with this module's other name-only matching."""


def _base_name(expr: ast.expr) -> str | None:
    """The bare name of a `Name` or `Attribute` reference, e.g. "Base" for
    both `Base` and `orm.Base`. Anything more dynamic returns `None`."""
    if isinstance(expr, ast.Name):
        return expr.id
    if isinstance(expr, ast.Attribute):
        return expr.attr
    return None


def _is_declarative_model(node: ast.ClassDef) -> bool:
    return any(_base_name(base) in _DECLARATIVE_BASE_NAMES for base in node.bases)


def _call_name(expr: ast.expr) -> str | None:
    if not isinstance(expr, ast.Call):
        return None
    return _base_name(expr.func)


def _string_const(expr: ast.expr | None) -> str | None:
    if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
        return expr.value
    return None


def _tablename(node: ast.ClassDef) -> str | None:
    for stmt in node.body:
        target: ast.expr | None = None
        value: ast.expr | None = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            target, value = stmt.targets[0], stmt.value
        elif isinstance(stmt, ast.AnnAssign):
            target, value = stmt.target, stmt.value
        if isinstance(target, ast.Name) and target.id == "__tablename__":
            return _string_const(value)
    return None


def _foreign_key_target_table(column_call: ast.Call) -> str | None:
    """The referenced table name out of a `Column(..., ForeignKey("table.col"))`
    or `Column(..., ForeignKey("schema.table.col"))` argument, if the call
    literally has one. `None` for anything not a plain string literal (a
    computed/f-string target isn't guessed at) or without a column
    component to split off."""
    for arg in column_call.args:
        if _call_name(arg) != "ForeignKey":
            continue
        assert isinstance(arg, ast.Call)
        if not arg.args:
            return None
        target = _string_const(arg.args[0])
        if target is None:
            return None
        # The table name is always the second-to-last dot-separated part --
        # "table.col" -> "table", "schema.table.col" -> "table" (not the
        # schema prefix, which `.split(".", 1)[0]` would wrongly return).
        parts = target.split(".")
        if len(parts) < 2 or not parts[-2]:
            return None
        return parts[-2]
    return None


_COLUMN_CALL_NAMES = frozenset({"Column", "mapped_column"})
"""Both the legacy `Column(...)` call and SQLAlchemy 2.0's
`mapped_column(...)` declare a column and may carry a `ForeignKey(...)`
argument the same way."""


def _foreign_key_targets(node: ast.ClassDef) -> list[str]:
    targets: list[str] = []
    for stmt in node.body:
        value: ast.expr | None = None
        if isinstance(stmt, ast.Assign):
            value = stmt.value
        elif isinstance(stmt, ast.AnnAssign):
            value = stmt.value
        if _call_name(value) not in _COLUMN_CALL_NAMES:
            continue
        target = _foreign_key_target_table(value)
        if target is not None:
            targets.append(target)
    return targets


def extract(sources: dict[str, str]) -> SqlAlchemyResult:
    """Scans every given Python source (`rel_path -> source text`) for
    top-level SQLAlchemy declarative model classes, reconciling `Table`
    nodes by table name across files within this same pass -- two models
    in different files declaring the same `__tablename__` map to one
    node, not two. Nested classes are not scanned; declarative models are
    idiomatically module-level."""
    tables: dict[str, Node] = {}
    model_tables: dict[str, str] = {}
    maps_to: list[Edge] = []
    foreign_keys: list[Edge] = []
    seen_foreign_keys: set[tuple[str, str]] = set()
    """(source table id, target table id) pairs already emitted -- this
    edge is table-level, not column-level (matching the FK edge's own
    "table -> table" shape), so two FK columns pointing at the same
    target table -- whether on the same class or a same-named table
    reconciled from two files -- collapse to one edge, not a duplicate
    per column."""

    for rel_path, source in sources.items():
        try:
            tree = ast.parse(source, filename=rel_path)
        except SyntaxError:
            continue

        for stmt in tree.body:
            if not isinstance(stmt, ast.ClassDef) or not _is_declarative_model(stmt):
                continue
            table_name = _tablename(stmt)
            if table_name is None:
                continue

            table_id = table_node_id(table_name)
            if table_id not in tables:
                tables[table_id] = Node(
                    id=table_id,
                    kind=NodeKind.TABLE,
                    label=table_name,
                    file=rel_path,
                    line_start=stmt.lineno,
                    line_end=stmt.end_lineno or stmt.lineno,
                    source="orm_model",
                )

            class_id = f"{rel_path}::{stmt.name}"
            maps_to.append(Edge(source=class_id, target=table_id, kind=EdgeKind.MAPS_TO))
            model_tables[stmt.name] = table_id

            for fk_target in _foreign_key_targets(stmt):
                fk_target_id = table_node_id(fk_target)
                if (table_id, fk_target_id) in seen_foreign_keys:
                    continue
                seen_foreign_keys.add((table_id, fk_target_id))
                foreign_keys.append(
                    Edge(source=table_id, target=fk_target_id, kind=EdgeKind.FOREIGN_KEY)
                )

    return SqlAlchemyResult(
        nodes=list(tables.values()),
        edges=[*maps_to, *foreign_keys],
        model_tables=model_tables,
    )
