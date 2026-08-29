"""Function-to-table `READS`/`WRITES` detection (Milestone 17b) -- an
additive pass over the same Python sources, run after
`dataflow/sqlalchemy_parser.py` so it can recognize calls that touch a
known declarative model by name.

Two independent tiers, per the build plan:

1. ORM-usage recognition, three narrowly-scoped shapes only (a first
   review round found that a broader "any call literally named
   query/select/get/insert/update/delete, with a known model as its
   first argument" heuristic produces real false positives on ordinary
   non-ORM code -- `cache.get(User, default)`, `registry.update(User,
   ...)` -- since those verbs are among the most common method names in
   any codebase, not just SQLAlchemy's):
   - `Model(...)` -- a *bare-name* call directly naming a known model
     class (not an attribute-qualified `mod.Model(...)`, which would
     widen collision risk for comparatively little gain) -- a write.
   - `session.query(Model)` -- specifically the `.query` attribute,
     which is SQLAlchemy-idiomatic enough to keep as a standalone
     signal -- a read.
   - `session.execute(select(Model))` / `session.execute(insert(Model)
     ...)` / `...update(Model)...` / `...delete(Model)...` -- only
     recognized when the read/write-oriented call is literally the
     direct argument of an `execute(...)` call, a much stronger signal
     than a bare `update(Model)`/`get(Model)` call anywhere in the code.
   Any other shape referencing the model -- attribute access,
   `session.add(x)`, a filter expression, or the Flask-SQLAlchemy
   `Model.query.filter_by(...)` class-descriptor idiom (as opposed to
   `session.query(Model)`) -- is not detected. This is
   table-level, name-based ORM-usage recognition, not general dataflow
   analysis, and it is repo-wide/name-only like `sqlalchemy_parser.py`'s
   own model detection: it doesn't verify the name was actually imported
   into the calling file's scope, an accepted heuristic limitation
   consistent with that module. Constructing a model that's never
   actually persisted (a transient/test/factory object) is still
   counted as a write -- a known, documented tradeoff of "direct use"
   being the tier's definition, not a dataflow/session-tracking analysis.
2. A lightweight tokenizer over string literals passed to `execute(...)`/
   `*.execute(...)`, split on top-level `;` into individual statements
   (so a multi-statement string is classified per statement, not as one
   blob) and scoped *narrowly per each statement's own leading verb*
   rather than scanning the whole statement for every FROM/INTO/UPDATE
   keyword -- a first review round found that a whole-statement scan
   misclassifies a nested subquery's own FROM target (e.g. an
   `UPDATE ... WHERE id IN (SELECT id FROM other_table)` wrongly
   counted `other_table` as written). The statement split
   (`_split_sql_statements`) is quote-aware, not a plain `str.split(";")`
   -- a second review round found that a `;` inside a `'...'`-quoted
   string literal's own *content* (e.g. a free-text notes field,
   `"UPDATE users SET note = 'ok; thanks' WHERE id=1"`) was otherwise
   mistaken for a statement boundary and fabricated a second, spurious
   statement. `JOIN` targets are always reads, regardless of the
   statement's own verb, since a JOIN clause reads rows to match against
   even inside an UPDATE/DELETE. A `SELECT` embedded earlier than the
   primary table in the same statement (e.g. a subquery inside the
   *select list* rather than after a `WHERE`) can still be misread as
   the primary target -- a narrower, rarer shape left as a known
   remaining limitation of a regex tokenizer rather than a real SQL
   parser.

Both tiers default to table-level, and skip rather than guess: a
non-literal SQL string (an f-string, a concatenation, a variable), a SQL
statement with no recognized leading verb, or a call whose model-touch
shape isn't one of the ones listed above produces no edge. Calls made at
class-body level (outside any method) are not scanned, same as
`sqlalchemy_parser.py`'s own model detection only looking at declarative
fields, not arbitrary class-body statements.

Column-level narrowing (Milestone 17e), on top of the same two tiers,
only where a column can be named with no guessing: a tier-1 `Model(...)`
constructor's own keyword arguments (`User(name=...)` names `name`
directly), and a tier-2 raw `INSERT INTO t (a, b)`/`UPDATE t SET a = ..`
column list (a `SELECT`'s projected columns are not similarly
enumerable -- `*`, expressions, joins -- and stay table-level). A parsed
column name that doesn't match any column a known model actually declares
is dropped, not synthesized, and the touch falls back to its table-level
edge -- same "skip rather than guess" policy as everything else here.
"""

from __future__ import annotations

import ast
import re

from semantic_vision.dataflow.sqlalchemy_parser import _base_name, _string_const, table_node_id
from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import _iter_scoped_defs

_EXECUTE_ARG_READ_NAMES = frozenset({"select"})
_EXECUTE_ARG_WRITE_NAMES = frozenset({"insert", "update", "delete"})

_TABLE_REF = r"([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)"
_SQL_LEADING_VERB_RE = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE)\b", re.IGNORECASE)
_SQL_FROM_RE = re.compile(rf"\bFROM\s+{_TABLE_REF}", re.IGNORECASE)
_SQL_INTO_RE = re.compile(rf"\bINTO\s+{_TABLE_REF}", re.IGNORECASE)
_SQL_UPDATE_TARGET_RE = re.compile(rf"^\s*UPDATE\s+{_TABLE_REF}", re.IGNORECASE)
_SQL_JOIN_RE = re.compile(rf"\bJOIN\s+{_TABLE_REF}", re.IGNORECASE)

_SQL_INSERT_COLUMNS_RE = re.compile(rf"\bINTO\s+{_TABLE_REF}\s*\(([^)]*)\)", re.IGNORECASE)
"""`INSERT INTO t (a, b, c)` -- the column list is always a flat,
comma-separated list of bare identifiers with no nested parens (unlike the
`VALUES (...)` that follows it, which can contain function calls/nested
expressions), so matching up to the first `)` is safe and doesn't need the
quote-aware scanning `_split_sql_statements` uses for `;`. Absent for an
`INSERT INTO t SELECT ...` or a columnless `INSERT INTO t VALUES (...)` --
both correctly fall back to a table-level touch (see `detect()`), since
there's genuinely no column list to read in either shape."""

_SQL_SET_CLAUSE_RE = re.compile(r"\bSET\s+(.*?)(?:\bWHERE\b|$)", re.IGNORECASE | re.DOTALL)
_SQL_SET_COLUMN_RE = re.compile(r"(?:^|,)\s*(\w+)\s*=(?!=)")
"""Column names out of an `UPDATE`'s `SET a = 1, b = 2 WHERE ...` clause.
Each candidate must be anchored right after the clause's own start or a
top-level `,` (not just any `name =` anywhere in the clause) -- a plain
`(\\w+)\\s*=(?!=)` scan with no anchor was tried first and misread a `,` or
`=` sitting *inside* a value's own string literal (`SET note = 'a=b'`) as
a second assignment. Still not a full comma-tokenizer (which
`_split_sql_statements` already has to be for top-level `;`, since a
value can contain a comma inside a string/function call) -- anchoring
each match to immediately follow a comma, rather than tokenizing the
whole clause into comma-separated parts, sidesteps that without needing
one, consistent with this file's own "regex tokenizer, not a real SQL
parser" scope. A comma *inside* a string value (`SET note = 'a,b'`) still
can't start a false match this way, since nothing immediately after that
inner comma is followed by `=`."""


class _CallCollector(ast.NodeVisitor):
    """Collects every `ast.Call` made directly in this scope, flattening
    through nested function bodies (their calls belong to the enclosing
    named function, same as `parser/extractor.py`'s own `_CallCollector`)
    but stopping at a nested class (which would get its own scope). Kept
    as a full `ast.Call` here, unlike `extractor.py`'s version, because
    the pattern matching below needs real call arguments, not just a
    dotted callee name."""

    def __init__(self) -> None:
        self.calls: list[ast.Call] = []

    def visit_Call(self, node: ast.Call) -> None:
        self.calls.append(node)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        pass


def _collect_calls(stmts: list[ast.stmt]) -> list[ast.Call]:
    collector = _CallCollector()
    for stmt in stmts:
        collector.visit(stmt)
    return collector.calls


def _iter_functions(tree: ast.Module, rel_path: str) -> list[tuple[str, ast.stmt]]:
    """(function_id, def_node) for every top-level function and every
    top-level class's method, using the same id convention as
    `resolver/symbol_table.py` (`rel_path::name`, `rel_path::Class.method`).
    Deeply nested classes/functions are not scanned -- table-usage
    detection is scoped to the idiomatic common case, the same scope cut
    `sqlalchemy_parser.py` makes for model detection itself."""
    found: list[tuple[str, ast.stmt]] = []
    for item in _iter_scoped_defs(tree.body):
        if isinstance(item, ast.ClassDef):
            for member in _iter_scoped_defs(item.body):
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    found.append((f"{rel_path}::{item.name}.{member.name}", member))
        else:
            found.append((f"{rel_path}::{item.name}", item))
    return found


def _is_execute_call(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id == "execute"
    return isinstance(func, ast.Attribute) and func.attr == "execute"


def _construction_touch(
    call: ast.Call, model_class_names: set[str], model_columns: dict[str, dict[str, str]]
) -> list[tuple[str, EdgeKind]]:
    """`Model(...)` -- a write to the whole table by default, narrowed to
    the specific columns named by the call's own keyword arguments when
    any of them match a column this model actually declares (the keyword
    names *are* the column names -- e.g. `User(name=name)` names `name`
    directly, no guessing needed). A keyword that doesn't match any known
    column (a `**kwargs`-style call, a computed field, a genuinely unknown
    name) is silently not turned into a column touch -- same "skip rather
    than guess" policy as everywhere else in this file. Falls back to the
    table-level touch when nothing matches, so `Model()` (no args) or a
    call whose keywords are all unrecognized behaves exactly as it did
    before column-level tracking existed."""
    func = call.func
    if not (isinstance(func, ast.Name) and func.id in model_class_names):
        return []
    columns = model_columns.get(func.id, {})
    matched_columns = [
        columns[kw.arg] for kw in call.keywords if kw.arg is not None and kw.arg in columns
    ]
    if matched_columns:
        return [(column_id, EdgeKind.WRITES) for column_id in matched_columns]
    return [(func.id, EdgeKind.WRITES)]


def _query_call_touch(call: ast.Call, model_class_names: set[str]) -> tuple[str, EdgeKind] | None:
    func = call.func
    if not (isinstance(func, ast.Attribute) and func.attr == "query"):
        return None
    if not call.args or not isinstance(call.args[0], ast.Name):
        return None
    name = call.args[0].id
    return (name, EdgeKind.READS) if name in model_class_names else None


def _call_chain(expr: ast.expr) -> list[ast.Call]:
    """Every `Call` in `expr`'s own method-chain lineage, outermost
    first -- e.g. `update(User).where(...).values(...)` yields
    `[<values(...) call>, <where(...) call>, <update(User) call>]`,
    since the construct that actually names the model (`update(User)`)
    is typically the innermost call in a fluent chain, not the one
    `execute(...)`'s argument directly is."""
    calls: list[ast.Call] = []
    node: ast.expr | None = expr
    while isinstance(node, ast.Call):
        calls.append(node)
        node = node.func.value if isinstance(node.func, ast.Attribute) else None
    return calls


def _execute_arg_touch(call: ast.Call, model_class_names: set[str]) -> tuple[str, EdgeKind] | None:
    """`session.execute(select(Model))`, and the same for a fluent
    `update(Model).where(...).values(...)`/`delete(Model).where(...)`
    chain -- only recognized when the read/write-oriented call is
    literally part of an `execute(...)` call's argument chain."""
    if not _is_execute_call(call) or not call.args:
        return None
    for inner in _call_chain(call.args[0]):
        if not inner.args or not isinstance(inner.args[0], ast.Name):
            continue
        arg0 = inner.args[0]
        if arg0.id not in model_class_names:
            continue
        inner_name = _base_name(inner.func)
        if inner_name in _EXECUTE_ARG_WRITE_NAMES:
            return arg0.id, EdgeKind.WRITES
        if inner_name in _EXECUTE_ARG_READ_NAMES:
            return arg0.id, EdgeKind.READS
    return None


def _orm_touches(
    call: ast.Call, model_class_names: set[str], model_columns: dict[str, dict[str, str]]
) -> list[tuple[str, EdgeKind]]:
    touches = list(_construction_touch(call, model_class_names, model_columns))
    for detector in (_query_call_touch, _execute_arg_touch):
        touch = detector(call, model_class_names)
        if touch is not None:
            touches.append(touch)
    return touches


def _sql_table_name(raw: str) -> str:
    return raw.rsplit(".", 1)[-1]


def _split_sql_statements(sql: str) -> list[str]:
    """Splits on top-level `;` only, treating a `'...'`-quoted string
    literal as opaque (a `;` inside a free-text field's *value*, e.g.
    `"UPDATE users SET note = 'ok; thanks' WHERE id=1"`, must not be
    mistaken for a statement boundary -- a naive `str.split(";")` found
    exactly this false statement boundary in review). SQL's own escape
    convention for a literal quote character inside a string is a
    doubled `''`, handled here so it doesn't end the string early."""
    statements: list[str] = []
    current: list[str] = []
    in_string = False
    i = 0
    length = len(sql)
    while i < length:
        char = sql[i]
        if in_string:
            current.append(char)
            if char == "'":
                if i + 1 < length and sql[i + 1] == "'":
                    current.append("'")
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if char == "'":
            in_string = True
            current.append(char)
        elif char == ";":
            statements.append("".join(current))
            current = []
        else:
            current.append(char)
        i += 1
    statements.append("".join(current))
    return statements


def _insert_columns(statement: str) -> list[str] | None:
    """The column list out of `INSERT INTO t (a, b, c) ...`, or `None` for
    `INSERT INTO t SELECT ...`/a columnless `INSERT INTO t VALUES (...)` --
    both correctly fall back to a table-level touch in `detect()`, since
    there's no column list to read."""
    match = _SQL_INSERT_COLUMNS_RE.search(statement)
    if match is None:
        return None
    columns = [name.strip().strip("`\"[]") for name in match.group(2).split(",")]
    return [name for name in columns if name] or None


def _update_set_columns(statement: str) -> list[str] | None:
    """The column names out of an `UPDATE`'s `SET a = 1, b = 2 WHERE ...`
    clause -- `None` only for a malformed statement with no `SET` at all
    (the leading-verb match already guarantees `UPDATE`, so a real `SET`
    is always expected; this is a defensive fallback, not a normal path)."""
    match = _SQL_SET_CLAUSE_RE.search(statement)
    if match is None:
        return None
    columns = _SQL_SET_COLUMN_RE.findall(match.group(1))
    return columns or None


def _sql_statement_touches(statement: str) -> list[tuple[str, EdgeKind, list[str] | None]]:
    verb_match = _SQL_LEADING_VERB_RE.match(statement)
    if verb_match is None:
        return []
    verb = verb_match.group(1).upper()
    touches: list[tuple[str, EdgeKind, list[str] | None]] = []

    if verb in ("SELECT", "DELETE"):
        match = _SQL_FROM_RE.search(statement)
        if match:
            kind = EdgeKind.READS if verb == "SELECT" else EdgeKind.WRITES
            touches.append((_sql_table_name(match.group(1)), kind, None))
    elif verb == "INSERT":
        match = _SQL_INTO_RE.search(statement)
        if match:
            table_name = _sql_table_name(match.group(1))
            touches.append((table_name, EdgeKind.WRITES, _insert_columns(statement)))
    elif verb == "UPDATE":
        # The target table is read directly off the leading `UPDATE`
        # keyword itself (`.match`, anchored at the statement start),
        # not off a generic FROM/UPDATE scan elsewhere in the statement
        # -- so an `UPDATE ... WHERE id IN (SELECT id FROM other)`
        # subquery's own FROM is correctly left untouched.
        match = _SQL_UPDATE_TARGET_RE.match(statement)
        if match:
            table_name = _sql_table_name(match.group(1))
            touches.append((table_name, EdgeKind.WRITES, _update_set_columns(statement)))

    for join_match in _SQL_JOIN_RE.finditer(statement):
        touches.append((_sql_table_name(join_match.group(1)), EdgeKind.READS, None))

    return touches


def _raw_sql_touches(call: ast.Call) -> list[tuple[str, EdgeKind, list[str] | None]]:
    if not _is_execute_call(call) or not call.args:
        return []
    sql = _string_const(call.args[0])
    if sql is None:
        return []
    touches: list[tuple[str, EdgeKind, list[str] | None]] = []
    for statement in _split_sql_statements(sql):
        touches.extend(_sql_statement_touches(statement))
    return touches


def detect(
    sources: dict[str, str],
    model_tables: dict[str, str],
    model_columns: dict[str, dict[str, str]],
) -> list[Edge]:
    """`READS`/`WRITES` edges from every function/method in `sources` to a
    table -- or, where a specific column can be pinned down, to that
    column instead (Milestone 17e) -- either via recognized ORM usage of a
    class in `model_tables` (tier 1) or a raw SQL string tokenized for a
    bare table name (tier 2). `model_tables`/`model_columns` are
    `sqlalchemy_parser.SqlAlchemyResult`'s own fields -- the caller runs
    that pass first.

    A raw-SQL table name is reconciled against a known model's table id
    case-insensitively (`select * from Users` still lands on the same
    `Table` node as a model whose `__tablename__` is `"users"`) before
    falling back to a freshly synthesized id for a table no model
    declared. A raw-SQL column name is reconciled the same way, but never
    synthesized -- a name that isn't a column any known model declared is
    silently dropped (see `_resolve_columns` below), and the touch falls
    back to table-level, exactly as if no column list had been parsed at
    all."""
    model_class_names = set(model_tables)
    known_table_ids_by_lower_name = {
        table_id.removeprefix("table::").lower(): table_id for table_id in model_tables.values()
    }
    known_column_ids_by_lower_name: dict[tuple[str, str], str] = {}
    for class_name, columns in model_columns.items():
        table_id = model_tables.get(class_name)
        if table_id is None:
            continue
        table_bare_name = table_id.removeprefix("table::").lower()
        for attr_name, column_id in columns.items():
            known_column_ids_by_lower_name[(table_bare_name, attr_name.lower())] = column_id

    edges: list[Edge] = []
    seen: set[tuple[str, str, EdgeKind]] = set()

    def _emit(func_id: str, target: str, kind: EdgeKind) -> None:
        # `target` is either an already-resolved `column::...` id (from a
        # tier-1 construction touch or a resolved raw-SQL column, both
        # namespaced by `column_node_id`) or a bare table/class name still
        # needing resolution -- the `column::` prefix tells the two apart
        # without threading an extra "already resolved" flag everywhere.
        target_id = (
            target
            if target.startswith("column::")
            else (
                model_tables.get(target)
                or known_table_ids_by_lower_name.get(target.lower())
                or table_node_id(target)
            )
        )
        key = (func_id, target_id, kind)
        if key in seen:
            return
        seen.add(key)
        edges.append(Edge(source=func_id, target=target_id, kind=kind))

    def _resolve_columns(table_name: str, column_names: list[str] | None) -> list[str]:
        if not column_names:
            return []
        resolved = (
            known_column_ids_by_lower_name.get((table_name.lower(), name.lower()))
            for name in column_names
        )
        return [column_id for column_id in resolved if column_id is not None]

    for rel_path, source in sources.items():
        try:
            tree = ast.parse(source, filename=rel_path)
        except SyntaxError:
            continue

        for func_id, def_node in _iter_functions(tree, rel_path):
            for call in _collect_calls(def_node.body):
                for name_or_id, kind in _orm_touches(call, model_class_names, model_columns):
                    _emit(func_id, name_or_id, kind)
                for table_name, kind, column_names in _raw_sql_touches(call):
                    resolved_columns = _resolve_columns(table_name, column_names)
                    if resolved_columns:
                        for column_id in resolved_columns:
                            _emit(func_id, column_id, kind)
                    else:
                        _emit(func_id, table_name, kind)

    return edges
