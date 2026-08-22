from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from semantic_vision.api.cache import cache
from semantic_vision.api.schemas import (
    DocIndexResponse,
    DocResponse,
    FunctionSourceResponse,
    GraphResponse,
    GraphStateResponse,
    ParseRepoRequest,
    ParseRepoResponse,
    SaveGraphStateRequest,
)
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

    cache.set(request.path, result)
    persistence.write_metadata(
        Path(result.root),
        node_count=len(result.nodes),
        edge_count=len(result.edges),
        parse_error_count=len(result.parse_errors),
    )
    return ParseRepoResponse(
        path=result.root,
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
    result = _get_cached(path)
    state = persistence.read_graph_state(Path(result.root))
    return GraphStateResponse(positions=state.positions, updated_at=state.updated_at)


@router.put("/graph-state", response_model=GraphStateResponse)
def save_graph_state(request: SaveGraphStateRequest, path: str = Query(...)) -> GraphStateResponse:
    result = _get_cached(path)
    state = persistence.write_graph_state(Path(result.root), request.positions)
    return GraphStateResponse(positions=state.positions, updated_at=state.updated_at)


@router.get("/docs", response_model=DocIndexResponse)
def list_docs(path: str = Query(...)) -> DocIndexResponse:
    result = _get_cached(path)
    index = persistence.read_docs_index(Path(result.root))
    return DocIndexResponse(entries=index.entries)


@router.get("/doc", response_model=DocResponse)
def get_doc(path: str = Query(...), id: str = Query(...)) -> DocResponse:
    result = _get_cached(path)
    index = persistence.read_docs_index(Path(result.root))
    entry = next((e for e in index.entries if e.node_id == id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No saved documentation for: {id}")

    markdown = persistence.read_doc(Path(result.root), id)
    if markdown is None:
        raise HTTPException(status_code=404, detail=f"No saved documentation for: {id}")

    return DocResponse(node_id=id, markdown=markdown, updated_at=entry.updated_at)
