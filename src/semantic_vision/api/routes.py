from __future__ import annotations

import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from semantic_vision.ai.context import assemble_context
from semantic_vision.ai.providers import ProviderError, list_ollama_models, stream_documentation
from semantic_vision.analysis.impact import DEFAULT_MAX_DEPTH, find_upstream_callers
from semantic_vision.api.cache import cache
from semantic_vision.api.schemas import (
    ComplexityResponse,
    DbConnectionIngestRequest,
    DbConnectionIngestResponse,
    DbtManifestIngestRequest,
    DbtManifestIngestResponse,
    DocIndexResponse,
    DocResponse,
    DocRootResponse,
    FlowchartResponse,
    FunctionSourceResponse,
    GenerateDocRequest,
    GraphResponse,
    GraphStateResponse,
    HealthResponse,
    ImpactResponse,
    OllamaModelsResponse,
    ParseRepoRequest,
    ParseRepoResponse,
    SaveDocRequest,
    SaveGraphStateRequest,
    UpdateDocRootRequest,
)
from semantic_vision.dataflow import db_introspect, dbt_ingest
from semantic_vision.flowchart.cfg import build_flowchart
from semantic_vision.languages import UnknownLanguageError
from semantic_vision.models import Edge, EdgeKind, Node, NodeKind, ParseResult
from semantic_vision.persistence import store as persistence
from semantic_vision.repo_parser import parse_repository

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.post("/parse-repo", response_model=ParseRepoResponse)
def parse_repo(request: ParseRepoRequest) -> ParseRepoResponse:
    try:
        result = parse_repository(request.path, language=request.language)
    except (NotADirectoryError, PermissionError, UnknownLanguageError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    doc_root = persistence.resolve_doc_root(Path(result.root), request.doc_root)
    cache.set(request.path, result)
    cache.set_doc_root(request.path, doc_root)
    persistence.write_metadata(
        doc_root,
        node_count=len(result.nodes),
        edge_count=len(result.edges),
        parse_error_count=len(result.parse_errors),
    )
    return ParseRepoResponse(
        path=result.root,
        doc_root=doc_root.as_posix(),
        node_count=len(result.nodes),
        edge_count=len(result.edges),
        parse_errors=result.parse_errors,
    )


def _get_cached(path: str) -> ParseResult:
    result = cache.get(path)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Repository not parsed yet: {path}. Call POST /api/parse-repo first.",
        )
    return result


def _get_doc_root(path: str) -> Path:
    doc_root = cache.get_doc_root(path)
    assert doc_root is not None, "doc root is set alongside the cached parse result"
    return doc_root


@router.put("/doc-root", response_model=DocRootResponse)
def update_doc_root(request: UpdateDocRootRequest, path: str = Query(...)) -> DocRootResponse:
    """Changes where `.visualiser/` is written for an already-parsed repo,
    without re-parsing -- parsing a large repo can be slow, and relocating
    the save path shouldn't force paying that cost again."""
    _get_cached(path)
    doc_root = Path(request.doc_root).resolve()
    cache.set_doc_root(path, doc_root)
    return DocRootResponse(doc_root=doc_root.as_posix())


@router.get("/graph", response_model=GraphResponse)
def get_graph(path: str = Query(...)) -> GraphResponse:
    result = _get_cached(path)
    return GraphResponse(nodes=result.nodes, edges=result.edges)


@router.get("/function-source", response_model=FunctionSourceResponse)
def get_function_source(
    path: str = Query(...), id: str = Query(...)
) -> FunctionSourceResponse:
    result = _get_cached(path)
    node = next((n for n in result.nodes if n.id == id), None)
    if node is None or node.kind != NodeKind.FUNCTION:
        raise HTTPException(status_code=404, detail=f"Function not found: {id}")

    file_path = Path(result.root) / node.file
    try:
        lines = file_path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise HTTPException(
            status_code=404, detail=f"Source file not found: {node.file}"
        ) from exc

    source = "\n".join(lines[node.line_start - 1 : node.line_end])
    return FunctionSourceResponse(
        id=node.id,
        file=node.file,
        line_start=node.line_start,
        line_end=node.line_end,
        source=source,
    )


@router.get("/graph-state", response_model=GraphStateResponse)
def get_graph_state(path: str = Query(...)) -> GraphStateResponse:
    _get_cached(path)
    state = persistence.read_graph_state(_get_doc_root(path))
    return GraphStateResponse(positions=state.positions, updated_at=state.updated_at)


@router.put("/graph-state", response_model=GraphStateResponse)
def save_graph_state(request: SaveGraphStateRequest, path: str = Query(...)) -> GraphStateResponse:
    _get_cached(path)
    state = persistence.write_graph_state(_get_doc_root(path), request.positions)
    return GraphStateResponse(positions=state.positions, updated_at=state.updated_at)


@router.get("/impact", response_model=ImpactResponse)
def get_impact(
    path: str = Query(...),
    id: str = Query(...),
    max_depth: int = Query(DEFAULT_MAX_DEPTH, ge=1),
) -> ImpactResponse:
    result = _get_cached(path)
    if not any(node.id == id for node in result.nodes):
        raise HTTPException(status_code=404, detail=f"Node not found: {id}")

    reverse_index = cache.get_reverse_caller_index(path)
    assert reverse_index is not None, "reverse index is built alongside the cached parse result"
    impact = find_upstream_callers(id, reverse_index, max_depth=max_depth)
    return ImpactResponse(
        target=impact.target, callers=impact.callers, edges=impact.edges, cycles=impact.cycles
    )


def _merge_into_cache(
    path: str, result: ParseResult, new_nodes: list[Node], new_edges: list[Edge]
) -> None:
    """Merges freshly-ingested nodes/edges into the already-cached
    `ParseResult` for `path` and re-stores it -- re-running `cache.set`
    also rebuilds the reverse-caller index and drops any stale
    complexity index, the same as a genuine reparse would. Idempotent
    against re-ingesting the same manifest twice: a node id or
    `(source, target, kind)` edge already present is not duplicated."""
    existing_node_ids = {n.id for n in result.nodes}
    existing_edge_keys = {(e.source, e.target, e.kind) for e in result.edges}

    merged_nodes = list(result.nodes)
    for node in new_nodes:
        if node.id not in existing_node_ids:
            merged_nodes.append(node)
            existing_node_ids.add(node.id)

    merged_edges = list(result.edges)
    for edge in new_edges:
        key = (edge.source, edge.target, edge.kind)
        if key not in existing_edge_keys:
            merged_edges.append(edge)
            existing_edge_keys.add(key)

    merged = result.model_copy(
        update={
            "nodes": sorted(merged_nodes, key=lambda n: n.id),
            "edges": sorted(merged_edges, key=lambda e: (e.source, e.target, e.kind)),
        }
    )
    cache.set(path, merged)


def _strip_previous_dbt_ingest(result: ParseResult) -> ParseResult:
    """A dbt-manifest ingest fully re-syncs its own contribution to the
    graph on every call, rather than merging additively forever: every
    `DBT_MODEL` node and every `REFERENCES`/`MATERIALIZES` edge is
    produced exclusively by this pipeline (nothing else in the codebase
    emits either edge kind), so a stale one from a previous ingest -- a
    model renamed, an upstream `ref()` removed, a model deleted from the
    dbt project -- must be retracted before the fresh ingest's own set
    is added back in, or the graph would keep asserting a lineage
    relationship that no longer exists. `Table` nodes are deliberately
    left in place even if now unreferenced by the fresh manifest: they
    may still be real (from 17a's SQLAlchemy parsing, or simply a table
    the fresh manifest still names under the same alias, which should
    reconcile onto the same node rather than needing re-creation)."""
    kept_nodes = [n for n in result.nodes if n.kind != NodeKind.DBT_MODEL]
    kept_edges = [
        e for e in result.edges if e.kind not in (EdgeKind.REFERENCES, EdgeKind.MATERIALIZES)
    ]
    return result.model_copy(update={"nodes": kept_nodes, "edges": kept_edges})


_dbt_ingest_lock = threading.Lock()
"""Guards the read-strip-merge-write critical section below against a
lost update from two concurrent `POST /api/dataflow/dbt-manifest` calls
for the same repo path -- `RepoCache` already guards its own lazily-built
complexity index against an analogous race (`_complexity_lock`); this is
the same class of concern for this route's own read-modify-write. Does
not protect against a concurrent `POST /api/parse-repo` racing an ingest
for the same path -- a larger, pre-existing gap across every
cache-mutating route, out of scope for this one fix."""


@router.post("/dataflow/dbt-manifest", response_model=DbtManifestIngestResponse)
def ingest_dbt_manifest(
    request: DbtManifestIngestRequest, path: str = Query(...)
) -> DbtManifestIngestResponse:
    with _dbt_ingest_lock:
        result = _strip_previous_dbt_ingest(_get_cached(path))
        existing_table_ids = {n.id for n in result.nodes if n.kind == NodeKind.TABLE}

        try:
            ingested = dbt_ingest.ingest(request.path, existing_table_ids)
        except dbt_ingest.DbtManifestError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        _merge_into_cache(path, result, ingested.nodes, ingested.edges)

    return DbtManifestIngestResponse(
        models_ingested=ingested.models_ingested,
        tables_reconciled=ingested.tables_reconciled,
        tables_created=ingested.tables_created,
    )


def _strip_previous_live_db_ingest(result: ParseResult) -> ParseResult:
    """Mirrors `_strip_previous_dbt_ingest`'s full-re-sync approach,
    scoped to what a live-db introspection can unambiguously attribute
    to itself: every `Table` node tagged `source="live_db"` (nothing
    else ever creates that tag -- see `db_introspect.py`'s "first source
    wins" rule). Every edge touching one of those node ids -- as source
    *or* target, of any kind, not just `FOREIGN_KEY` sourced from one --
    is retracted too: once a node is gone, any edge still pointing at it
    would dangle at a nonexistent node, which is worse than the edge
    just being stale (review caught this concretely -- a `FOREIGN_KEY`
    edge from an unrelated `orm_model`-tagged table to a live-db table
    that got dropped from the schema left a broken reference the first
    version of this function only retracted from the *source* side).
    This does NOT retract a `FOREIGN_KEY` edge sourced from a table that
    reconciled onto a pre-existing `orm_model`-tagged node and STILL
    targets a node that still exists -- e.g. an ORM-declared table's own
    live-DB-only FK to another still-present table can go stale between
    two introspections without the target node disappearing, and there
    is no edge-level provenance in this data model to attribute that
    specific edge to a previous introspection versus 17a's own FK
    detection. That specific, narrower case can persist until a fresh
    parse -- a known, documented gap, not a silent one."""
    live_db_table_ids = {
        n.id for n in result.nodes if n.kind == NodeKind.TABLE and n.source == "live_db"
    }
    kept_nodes = [n for n in result.nodes if n.id not in live_db_table_ids]
    kept_edges = [
        e
        for e in result.edges
        if e.source not in live_db_table_ids and e.target not in live_db_table_ids
    ]
    return result.model_copy(update={"nodes": kept_nodes, "edges": kept_edges})


_db_introspect_lock = threading.Lock()
"""Same read-strip-merge-write race concern as `_dbt_ingest_lock`, for
`POST /api/dataflow/db-connection` calls against the same repo path."""


@router.post("/dataflow/db-connection", response_model=DbConnectionIngestResponse)
def ingest_db_connection(
    request: DbConnectionIngestRequest, path: str = Query(...)
) -> DbConnectionIngestResponse:
    with _db_introspect_lock:
        result = _strip_previous_live_db_ingest(_get_cached(path))
        existing_table_ids = {n.id for n in result.nodes if n.kind == NodeKind.TABLE}

        try:
            introspected = db_introspect.introspect(request.connection_string, existing_table_ids)
        except db_introspect.DbIntrospectError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        _merge_into_cache(path, result, introspected.nodes, introspected.edges)

    return DbConnectionIngestResponse(
        tables_ingested=introspected.tables_ingested,
        tables_reconciled=introspected.tables_reconciled,
        tables_created=introspected.tables_created,
    )


@router.get("/complexity", response_model=ComplexityResponse)
def get_complexity(path: str = Query(...)) -> ComplexityResponse:
    """Repo-wide, not per-node: the heatmap overlay and the ranked report
    pane both need the whole score set at once, and it's cheap to send in
    one call since it's built lazily on first request and cached from then
    on -- not every parse-repo call pays this cost, only the first repo
    whose complexity is actually looked at."""
    _get_cached(path)
    complexity_index = cache.get_or_build_complexity_index(path)
    return ComplexityResponse(scores=list(complexity_index.values()))


@router.get("/flowchart", response_model=FlowchartResponse)
def get_flowchart(path: str = Query(...), id: str = Query(...)) -> FlowchartResponse:
    result = _get_cached(path)
    node = next((n for n in result.nodes if n.id == id), None)
    if node is None or node.kind != NodeKind.FUNCTION:
        raise HTTPException(status_code=404, detail=f"Function not found: {id}")

    flowchart = build_flowchart(result, id)
    return FlowchartResponse(
        target=flowchart.target,
        entry=flowchart.entry,
        nodes=flowchart.nodes,
        edges=flowchart.edges,
    )


@router.get("/docs", response_model=DocIndexResponse)
def list_docs(path: str = Query(...)) -> DocIndexResponse:
    _get_cached(path)
    index = persistence.read_docs_index(_get_doc_root(path))
    return DocIndexResponse(entries=index.entries)


@router.get("/doc", response_model=DocResponse)
def get_doc(path: str = Query(...), id: str = Query(...)) -> DocResponse:
    _get_cached(path)
    doc_root = _get_doc_root(path)
    index = persistence.read_docs_index(doc_root)
    entry = next((e for e in index.entries if e.node_id == id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No saved documentation for: {id}")

    markdown = persistence.read_doc(doc_root, id)
    if markdown is None:
        raise HTTPException(status_code=404, detail=f"No saved documentation for: {id}")

    return DocResponse(node_id=id, markdown=markdown, updated_at=entry.updated_at)


@router.post("/generate-doc")
def generate_doc(
    request: GenerateDocRequest, path: str = Query(...), id: str = Query(...)
) -> StreamingResponse:
    result = _get_cached(path)
    node = next((n for n in result.nodes if n.id == id), None)
    if node is None or node.kind != NodeKind.FUNCTION:
        raise HTTPException(status_code=404, detail=f"Function not found: {id}")

    context = assemble_context(result, id)
    try:
        stream = stream_documentation(request.provider, context, request.model)
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return StreamingResponse(stream, media_type="text/plain")


@router.get("/ollama-models", response_model=OllamaModelsResponse)
def get_ollama_models() -> OllamaModelsResponse:
    return OllamaModelsResponse(models=list_ollama_models())


@router.post("/doc", response_model=DocResponse)
def save_doc(request: SaveDocRequest, path: str = Query(...), id: str = Query(...)) -> DocResponse:
    result = _get_cached(path)
    if not any(n.id == id for n in result.nodes):
        raise HTTPException(status_code=404, detail=f"Node not found: {id}")

    entry = persistence.write_doc(_get_doc_root(path), id, request.markdown)
    return DocResponse(node_id=id, markdown=request.markdown, updated_at=entry.updated_at)
