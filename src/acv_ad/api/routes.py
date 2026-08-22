from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from acv_ad.api.cache import cache
from acv_ad.api.schemas import (
    FunctionSourceResponse,
    GraphResponse,
    ParseRepoRequest,
    ParseRepoResponse,
)
from acv_ad.models import NodeKind, ParseResult
from acv_ad.repo_parser import parse_repository

router = APIRouter(prefix="/api")


@router.post("/parse-repo", response_model=ParseRepoResponse)
def parse_repo(request: ParseRepoRequest) -> ParseRepoResponse:
    try:
        result = parse_repository(request.path)
    except (NotADirectoryError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cache.set(request.path, result)
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
