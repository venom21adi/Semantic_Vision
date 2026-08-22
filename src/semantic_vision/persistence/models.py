"""Shapes persisted under a repository's `.visualiser/` directory."""

from __future__ import annotations

from pydantic import BaseModel


class NodePosition(BaseModel):
    x: float
    y: float


class GraphState(BaseModel):
    positions: dict[str, NodePosition] = {}
    updated_at: str | None = None


class RepoMetadata(BaseModel):
    node_count: int
    edge_count: int
    parse_error_count: int
    parsed_at: str


class DocIndexEntry(BaseModel):
    node_id: str
    hash: str
    updated_at: str


class DocIndex(BaseModel):
    entries: list[DocIndexEntry] = []
