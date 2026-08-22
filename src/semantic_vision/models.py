"""Data models for the parsed-repository graph.

These are the language-neutral shapes described in the build plan's API
contracts. They are produced by the parser/resolver pipeline and are also
what Milestone 2's FastAPI layer will serialize directly.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class NodeKind(StrEnum):
    DIRECTORY = "directory"
    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"


class EdgeKind(StrEnum):
    CALLS = "calls"
    IMPORTS = "imports"
    DEFINES = "defines"


class Node(BaseModel):
    id: str
    kind: NodeKind
    label: str
    file: str
    line_start: int
    line_end: int


class Edge(BaseModel):
    source: str
    target: str
    kind: EdgeKind
    external: bool = False
    ambiguous: bool = False


class ParseError(BaseModel):
    file: str
    line: int | None = None
    message: str


class Variable(BaseModel):
    id: str
    name: str
    file: str
    line: int
    annotation: str | None = None
    scope: str
    """Id of the enclosing node (file or class) this variable belongs to."""


class ParseResult(BaseModel):
    root: str
    nodes: list[Node]
    edges: list[Edge]
    variables: list[Variable]
    parse_errors: list[ParseError]
