from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from semantic_vision.ai.context import assemble_context
from semantic_vision.ai.providers import ProviderError, list_ollama_models, stream_documentation
from semantic_vision.analysis.impact import DEFAULT_MAX_DEPTH, find_upstream_callers
from semantic_vision.api.cache import cache
from semantic_vision.api.schemas import (
    DocIndexResponse,
    DocResponse,
    DocRootResponse,
    FlowchartResponse,
    FunctionSourceResponse,
    GenerateDocRequest,
    GraphResponse,
    GraphStateResponse,
    ImpactResponse,
    OllamaModelsResponse,
    ParseRepoRequest,
    ParseRepoResponse,
    SaveDocRequest,
    SaveGraphStateRequest,
    UpdateDocRootRequest,
)
from semantic_vision.flowchart.cfg import build_flowchart
from semantic_vision.models import NodeKind, ParseResult
from semantic_vision.persistence import store as persistence
from semantic_vision.repo_parser import parse_repository

router = APIRouter(prefix="/api")


@router.post("/parse-repo", response_model=ParseRepoResponse)
def parse_repo(request: ParseRepoRequest) -> ParseRepoResponse:
    try:
        result = parse_repository(request.path)
    except (NotADirectoryError, PermissionError) as exc:
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
