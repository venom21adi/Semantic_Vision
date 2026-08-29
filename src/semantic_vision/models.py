"""Data models for the parsed-repository graph.

These are the language-neutral shapes described in the build plan's API
contracts. They are produced by the parser/resolver pipeline and are also
what Milestone 2's FastAPI layer will serialize directly.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class NodeKind(StrEnum):
    DIRECTORY = "directory"
    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"
    TABLE = "table"
    DBT_MODEL = "dbt_model"
    COLUMN = "column"


class EdgeKind(StrEnum):
    CALLS = "calls"
    IMPORTS = "imports"
    DEFINES = "defines"
    """Containment: directory->file, file->function/class, class->method,
    and (Milestone 17e) table->column."""
    MAPS_TO = "maps_to"
    """ORM class -> the table it's declared against (Milestone 17a)."""
    FOREIGN_KEY = "foreign_key"
    """table -> table, from a declared foreign-key column (Milestone 17a)."""
    REFERENCES = "references"
    """dbt model -> dbt model, from its manifest `depends_on` (Milestone 17c)."""
    MATERIALIZES = "materializes"
    """dbt model -> the table it writes (Milestone 17c)."""
    READS = "reads"
    """function -> table (Milestone 17b)."""
    WRITES = "writes"
    """function -> table (Milestone 17b)."""


class Node(BaseModel):
    id: str
    kind: NodeKind
    label: str
    file: str
    line_start: int
    line_end: int
    source: str | None = None
    """Provenance tag for a `Table` node, e.g. "orm_model" (Milestone
    17a) or "live_db" (Milestone 17d, not yet built). Reconciliation
    across sources is a later slice's job -- today, the first source to
    see a given table name wins and no other source's node is compared
    against it. `None` for every node kind that only ever has one
    source."""
    accessor_kind: Literal["get", "set"] | None = None
    """JS/TS getter/setter marker (`get foo()` / `set foo(v)`), set only
    on a FUNCTION node produced from one of those. `label` deliberately
    stays the bare method name regardless (see `resolver/symbol_table.py`)
    -- this field is purely presentational, for a UI that wants to show
    "get foo"/"set foo" instead of two identically-labeled boxes."""


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
