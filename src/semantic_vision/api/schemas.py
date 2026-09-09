"""Request/response shapes for the API layer. `Node`/`Edge`/`ParseError`
are reused directly from `semantic_vision.models` -- the graph model doubles as
the wire format, per the build plan's API contracts.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from semantic_vision.analysis.complexity import ComplexityChange, ComplexityScore
from semantic_vision.analysis.coverage import CoverageRiskScore
from semantic_vision.analysis.dead_code import DeadCodeCandidate
from semantic_vision.analysis.duplicates import DuplicateGroup
from semantic_vision.analysis.hotspots import HotspotScore
from semantic_vision.analysis.impact import Caller
from semantic_vision.analysis.osv_client import VulnerabilitySummary
from semantic_vision.flowchart.cfg import FlowEdge, FlowNode
from semantic_vision.models import Edge, Node, ParseError
from semantic_vision.persistence.models import DocIndexEntry, NodePosition


class ParseRepoRequest(BaseModel):
    path: str
    doc_root: str | None = None
    """Where `.visualiser/` should be written. Defaults (server-side) to
    the nearest ancestor `.git` root of `path` -- see
    `persistence.store.resolve_doc_root`."""
    language: str = "python"
    """A registered `LanguageAdapter.language_id` (see
    `languages.registry`). A repo is parsed as one language at a time --
    there's no mixed-language discovery."""


class ParseRepoResponse(BaseModel):
    path: str
    doc_root: str
    """The resolved save location actually in effect -- whatever
    `resolve_doc_root` picked, whether that came from `doc_root` on the
    request or was auto-detected."""
    node_count: int
    edge_count: int
    parse_errors: list[ParseError]


class DocRootResponse(BaseModel):
    doc_root: str


class UpdateDocRootRequest(BaseModel):
    doc_root: str


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


class FlowchartResponse(BaseModel):
    target: str
    entry: str
    nodes: list[FlowNode]
    edges: list[FlowEdge]


class HealthResponse(BaseModel):
    status: Literal["ok"]


class ComplexityResponse(BaseModel):
    scores: list[ComplexityScore]


class ComplexityDiffResponse(BaseModel):
    available: bool
    current: list[ComplexityScore]
    added: list[ComplexityScore] = []
    removed: list[ComplexityScore] = []
    changed: list[ComplexityChange] = []


class GitCommitInfo(BaseModel):
    sha: str
    subject: str


class GitRefsResponse(BaseModel):
    is_git_repo: bool
    branches: list[str] = []
    commits: list[GitCommitInfo] = []


class ComplexityRefDiffResponse(BaseModel):
    ref: str
    to_ref: str | None = None
    """`None` means the comparison's "after" side was the current on-disk
    state (the default); otherwise it's this second arbitrary ref, both
    sides checked out into their own scratch worktree."""
    available: bool
    """Kept for shape parity with `ComplexityDiffResponse`; in practice
    always `True` once both refs parse successfully -- `/complexity/diff-ref`
    returns a 400 rather than `available=False` for anything that would
    prevent a comparison (no git repo, unknown ref)."""
    current: list[ComplexityScore]
    added: list[ComplexityScore] = []
    removed: list[ComplexityScore] = []
    changed: list[ComplexityChange] = []


class HotspotsResponse(BaseModel):
    is_git_repo: bool
    scores: list[HotspotScore] = []
    window_days: int


class DeadCodeResponse(BaseModel):
    candidates: list[DeadCodeCandidate] = []


class CoverageIngestRequest(BaseModel):
    path: str
    """Absolute path to a coverage.py XML report (`coverage xml`) or an
    lcov text report the user's own test-runner already produced --
    Semantic Vision never runs the test suite itself."""


class CoverageIngestResponse(BaseModel):
    files_in_report: int
    """Distinct file paths the coverage report itself mentions -- not
    cross-checked against the parsed repo."""
    files_matched: int
    """Of `files_in_report`, how many actually correspond to a parsed
    `Node.file` in this repo. `0` alongside a non-zero `files_in_report`
    is a real signal the report's paths don't line up with this repo's
    own (e.g. generated from a different working directory) -- every
    function's `coverage_ratio` will read `None`, not a bug."""
    lines_recorded: int


class CoverageResponse(BaseModel):
    available: bool
    """`False` until `POST /api/coverage/ingest` has been called at least
    once for this repo path since its last parse."""
    scores: list[CoverageRiskScore] = []


class DuplicatesResponse(BaseModel):
    groups: list[DuplicateGroup] = []


class DependencyRiskRequest(BaseModel):
    confirm_network_access: bool = False
    """Must be explicitly `True` -- this is the one route in this project
    that makes a live outbound network call (to osv.dev). The route
    itself rejects a request where this isn't `True` with a 400, not just
    a frontend UI gating it -- an explicit, server-enforced opt-in,
    mirroring how AI documentation's provider choice is a required,
    per-request field, never a silent default."""


class DependencyRisk(BaseModel):
    package: str
    version: str | None
    ecosystem: str
    vulnerabilities: list[VulnerabilitySummary] = []


class DependencyRiskResponse(BaseModel):
    available: bool
    """`False` only when the osv.dev query itself failed (network,
    timeout, unexpected response) -- see `message` for why. A repo with no
    used-and-declared packages to check is still `available: True` with an
    empty `risks` list, not unavailable."""
    risks: list[DependencyRisk] = []
    message: str | None = None


class DbtManifestIngestRequest(BaseModel):
    path: str
    """Absolute path to a `manifest.json` the user produced themselves
    via `dbt compile`/`dbt docs generate` -- Semantic Vision never
    invokes dbt itself."""


class DbtManifestIngestResponse(BaseModel):
    models_ingested: int
    tables_reconciled: int
    tables_created: int
    columns_reconciled: int
    columns_created: int


class DbConnectionIngestRequest(BaseModel):
    connection_string: str
    """A read-only DB connection string (e.g.
    `postgresql://readonly@host/db`). Held in memory for this request
    only -- never written to disk or logged."""


class DbConnectionIngestResponse(BaseModel):
    tables_ingested: int
    tables_reconciled: int
    tables_created: int
    columns_reconciled: int
    columns_created: int
