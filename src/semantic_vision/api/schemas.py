"""Request/response shapes for the API layer. `Node`/`Edge`/`ParseError`
are reused directly from `semantic_vision.models` -- the graph model doubles as
the wire format, per the build plan's API contracts.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from semantic_vision.analysis.impact import Caller
from semantic_vision.models import Edge, Node, ParseError
from semantic_vision.persistence.models import DocIndexEntry, NodePosition


class ParseRepoRequest(BaseModel):
    path: str


class ParseRepoResponse(BaseModel):
    path: str
    node_count: int
    edge_count: int
    parse_errors: list[ParseError]


class GraphResponse(BaseModel):
    nodes: list[Node]
    edges: list[Edge]


class FunctionSourceResponse(BaseModel):
    id: str
    file: str
    line_start: int
    line_end: int
    source: str


class GraphStateResponse(BaseModel):
    positions: dict[str, NodePosition]
    updated_at: str | None = None


class SaveGraphStateRequest(BaseModel):
    positions: dict[str, NodePosition]


class DocIndexResponse(BaseModel):
    entries: list[DocIndexEntry]


class DocResponse(BaseModel):
    node_id: str
    markdown: str
    updated_at: str


class GenerateDocRequest(BaseModel):
    provider: Literal["ollama", "openai", "anthropic"]
    model: str | None = None
    """Only honored for `provider == "ollama"` -- see `ai.providers.stream_documentation`."""


class SaveDocRequest(BaseModel):
    markdown: str


class OllamaModelsResponse(BaseModel):
    models: list[str]


class ImpactResponse(BaseModel):
    target: str
    callers: list[Caller]
    edges: list[Edge]
    cycles: list[list[str]]
