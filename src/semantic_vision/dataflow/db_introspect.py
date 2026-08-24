"""Live database schema introspection (Milestone 17d) -- given a
read-only connection string, queries the database's own schema catalog
(via SQLAlchemy's `inspect()`, used here purely as a dialect-agnostic
schema-introspection client -- unrelated to `sqlalchemy_parser.py`'s
static analysis of Python *source code* that happens to use the
SQLAlchemy ORM, which never imports the real `sqlalchemy` package at
all) and emits `Table` nodes tagged `source="live_db"` plus
`FOREIGN_KEY` edges, additive to an already-parsed `ParseResult`.

Like 17c's dbt ingestion, this is a one-time, user-triggered ingest
merged into an existing, already-cached `ParseResult` by the API layer
(`POST /api/dataflow/db-connection`) -- there's no source code to walk,
only a live database to query. `inspect()` only issues read-only
metadata/catalog queries; nothing here ever writes to the target
database.

Reconciliation by bare table name, "first source wins": introspecting a
table that already has a `Table` node (from 17a's SQLAlchemy parsing, a
prior dbt ingest, or a prior live-db introspection) reconciles onto that
existing node without changing its `source` tag -- only a genuinely new
table gets a freshly created node tagged `source="live_db"`. This keeps
the two provenances visibly distinct (an ORM-declared table introspected
against a live DB stays tagged `"orm_model"`, not silently relabeled)
rather than the most recent ingest always winning.

The connection string itself is never logged, never written to disk, and
held only for the duration of a single request -- the same trust
boundary already drawn for cloud AI provider API keys. Any error raised
here is deliberately re-worded rather than passing a driver's raw
exception text straight through: a real DBAPI error can embed the
connection string (credentials included) in its message, so every
user-facing error is built from `URL.render_as_string(hide_password=True)`
plus the exception's type name, never the exception's own text.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy
from sqlalchemy.exc import SQLAlchemyError

from semantic_vision.dataflow.sqlalchemy_parser import table_node_id
from semantic_vision.models import Edge, EdgeKind, Node, NodeKind

_CONNECTION_ERRORS = (SQLAlchemyError, ModuleNotFoundError, ImportError)


class DbIntrospectError(Exception):
    """Raised when the connection string can't be parsed, a required
    DBAPI driver isn't installed, or the database can't be reached or
    introspected -- the API layer turns this into a 400, not a crash."""


@dataclass
class DbIntrospectResult:
    nodes: list[Node]
    edges: list[Edge]
    tables_ingested: int
    tables_reconciled: int
    tables_created: int


def _redacted(connection_string: str) -> str:
    try:
        return sqlalchemy.engine.url.make_url(connection_string).render_as_string(
            hide_password=True
        )
    except Exception:
        # Genuinely unparseable -- there's nothing safe to echo back, not
        # even a redacted form, so fall back to a value with no
        # connection-string content in it at all.
        return "<connection string>"


def introspect(connection_string: str, existing_table_ids: set[str]) -> DbIntrospectResult:
    """`existing_table_ids` is every `Table` node id already in the
    current `ParseResult` -- used to decide whether an introspected
    table reconciles onto an existing node or needs a freshly created
    one."""
    redacted = _redacted(connection_string)
    engine = None
    try:
        engine = sqlalchemy.create_engine(connection_string)
        inspector = sqlalchemy.inspect(engine)
        table_names = inspector.get_table_names()

        nodes: list[Node] = []
        edges: list[Edge] = []
        created_tables: dict[str, Node] = {}
        seen_foreign_keys: set[tuple[str, str]] = set()
        tables_reconciled = 0
        tables_created = 0

        for table_name in table_names:
            table_id = table_node_id(table_name)
            if table_id in existing_table_ids or table_id in created_tables:
                tables_reconciled += 1
            else:
                tables_created += 1
                created_tables[table_id] = Node(
                    id=table_id,
                    kind=NodeKind.TABLE,
                    label=table_name,
                    file="live_db",
                    line_start=1,
                    line_end=1,
                    source="live_db",
                )

            for fk in inspector.get_foreign_keys(table_name):
                referred_table = fk.get("referred_table")
                if not referred_table:
                    continue
                target_id = table_node_id(referred_table)
                key = (table_id, target_id)
                if key in seen_foreign_keys:
                    continue
                seen_foreign_keys.add(key)
                edges.append(Edge(source=table_id, target=target_id, kind=EdgeKind.FOREIGN_KEY))
    except _CONNECTION_ERRORS as exc:
        raise DbIntrospectError(
            f"Could not connect to or introspect {redacted}: {type(exc).__name__}"
        ) from exc
    finally:
        if engine is not None:
            engine.dispose()

    nodes.extend(created_tables.values())
    return DbIntrospectResult(
        nodes=nodes,
        edges=edges,
        tables_ingested=len(table_names),
        tables_reconciled=tables_reconciled,
        tables_created=tables_created,
    )
