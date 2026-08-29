"""dbt manifest ingestion (Milestone 17c) -- reads a `manifest.json` the
user supplies (produced by the user's own `dbt compile`/`dbt docs
generate`; Semantic Vision never invokes dbt itself) and turns its models
into `DBT_MODEL` graph nodes, additive to an already-parsed `ParseResult`.

Unlike 17a/17b (which run automatically as part of every Python parse),
this is a one-time, user-triggered ingest merged into an existing,
already-cached `ParseResult` by the API layer (`POST
/api/dataflow/dbt-manifest`) -- there's no dbt-specific source code to
walk here, only a JSON artifact dbt itself already produced.

Reconciliation is by bare table name only, matching
`sqlalchemy_parser.py`'s own `table::<name>` convention -- schema/database
qualification in the manifest is deliberately not part of the id, the
same scope cut 17a already makes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from semantic_vision.dataflow.sqlalchemy_parser import column_node_id, table_node_id
from semantic_vision.models import Edge, EdgeKind, Node, NodeKind


class DbtManifestError(Exception):
    """Raised when `manifest_path` can't be read, isn't valid JSON, or
    doesn't look like a dbt manifest (no top-level `nodes` object) --
    the API layer turns this into a 400, not a crash."""


def dbt_model_node_id(unique_id: str) -> str:
    return f"dbt::{unique_id}"


@dataclass
class DbtIngestResult:
    nodes: list[Node]
    edges: list[Edge]
    models_ingested: int
    tables_reconciled: int
    tables_created: int
    columns_reconciled: int
    columns_created: int


def _load_manifest(manifest_path: str) -> dict[str, Any]:
    try:
        raw = Path(manifest_path).read_text(encoding="utf-8")
    except OSError as exc:
        raise DbtManifestError(f"Could not read manifest: {exc}") from exc
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DbtManifestError(f"Not valid JSON: {exc}") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("nodes"), dict):
        raise DbtManifestError("Not a dbt manifest: no top-level 'nodes' object")
    return manifest


def _model_table_name(model: dict[str, Any], unique_id: str) -> str | None:
    """The bare table/view name a model materializes to -- its `alias`
    if one is configured (overrides the default), else its own `name`,
    falling back to `unique_id` itself only for a malformed manifest
    entry missing both (real dbt manifests always populate `name`; this
    is a defensive fallback, not an expected path, so a non-ephemeral
    model never silently loses its `MATERIALIZES` edge just because a
    name field happened to be absent). `None` for an `ephemeral` model,
    which dbt inlines into whatever references it at compile time rather
    than materializing as its own table or view -- there's no real
    `MATERIALIZES` target to reconcile against, so none is guessed at."""
    config = model.get("config")
    if isinstance(config, dict) and config.get("materialized") == "ephemeral":
        return None
    alias = model.get("alias")
    if isinstance(alias, str) and alias:
        return alias
    name = model.get("name")
    if isinstance(name, str) and name:
        return name
    return unique_id


def _model_file(model: dict[str, Any]) -> str:
    path = model.get("original_file_path") or model.get("path")
    return path if isinstance(path, str) and path else "manifest.json"


def ingest(
    manifest_path: str, existing_table_ids: set[str], existing_column_ids: set[str] | None = None
) -> DbtIngestResult:
    """`existing_table_ids` is every `Table` node id already in the
    current `ParseResult` (from 17a's SQLAlchemy parsing, or a prior
    ingest) -- used to decide whether a model's `MATERIALIZES` target
    reconciles onto an existing node or needs a freshly created one.
    `existing_column_ids` is the same, one level down (Milestone 17e),
    defaulting to none-known so callers that don't care about column-level
    reconciliation (existing tests, primarily) don't have to pass it."""
    existing_column_ids = existing_column_ids or set()
    manifest = _load_manifest(manifest_path)
    raw_nodes: dict[str, Any] = manifest["nodes"]
    models = {
        unique_id: node
        for unique_id, node in raw_nodes.items()
        if isinstance(node, dict) and node.get("resource_type") == "model"
    }

    nodes: list[Node] = []
    edges: list[Edge] = []
    created_tables: dict[str, Node] = {}
    created_columns: dict[str, Node] = {}
    tables_reconciled = 0
    tables_created = 0
    columns_reconciled = 0
    columns_created = 0

    for unique_id, model in models.items():
        model_node_id = dbt_model_node_id(unique_id)
        label = model.get("name")
        nodes.append(
            Node(
                id=model_node_id,
                kind=NodeKind.DBT_MODEL,
                label=str(label) if label else unique_id,
                file=_model_file(model),
                line_start=1,
                line_end=1,
            )
        )

        depends_on = model.get("depends_on")
        dep_ids = depends_on.get("nodes") if isinstance(depends_on, dict) else None
        seen_deps: set[str] = set()
        for dep_id in dep_ids or []:
            if dep_id in models and dep_id not in seen_deps:
                seen_deps.add(dep_id)
                edges.append(
                    Edge(
                        source=model_node_id,
                        target=dbt_model_node_id(dep_id),
                        kind=EdgeKind.REFERENCES,
                    )
                )

        table_name = _model_table_name(model, unique_id)
        if table_name is None:
            continue
        table_id = table_node_id(table_name)
        edges.append(Edge(source=model_node_id, target=table_id, kind=EdgeKind.MATERIALIZES))

        if table_id in existing_table_ids or table_id in created_tables:
            tables_reconciled += 1
        else:
            tables_created += 1
            created_tables[table_id] = Node(
                id=table_id,
                kind=NodeKind.TABLE,
                label=table_name,
                file=_model_file(model),
                line_start=1,
                line_end=1,
                source="dbt",
            )

        columns = model.get("columns")
        if not isinstance(columns, dict):
            continue
        for column_name in columns:
            if not isinstance(column_name, str) or not column_name:
                continue
            column_id = column_node_id(table_name, column_name)
            edges.append(Edge(source=table_id, target=column_id, kind=EdgeKind.DEFINES))
            if column_id in existing_column_ids or column_id in created_columns:
                columns_reconciled += 1
            else:
                columns_created += 1
                created_columns[column_id] = Node(
                    id=column_id,
                    kind=NodeKind.COLUMN,
                    label=column_name,
                    file=_model_file(model),
                    line_start=1,
                    line_end=1,
                    source="dbt",
                )

    nodes.extend(created_tables.values())
    nodes.extend(created_columns.values())

    return DbtIngestResult(
        nodes=nodes,
        edges=edges,
        models_ingested=len(models),
        columns_reconciled=columns_reconciled,
        columns_created=columns_created,
        tables_reconciled=tables_reconciled,
        tables_created=tables_created,
    )
