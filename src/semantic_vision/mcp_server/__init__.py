"""`semantic-vision-mcp`: exposes the existing analysis engine (impact
analysis, complexity, complexity diff, hotspots, graph/lineage, flowchart)
as MCP tools any agent can call -- see
docs/progress/ROADMAP.md's "AI Coding Agent Integration & Impact Study".

Deliberately a thin HTTP client against the existing FastAPI backend
(`client.py`), not an in-process import of `semantic_vision.api.routes` --
`RepoCache` (`api/cache.py`) is a plain per-process in-memory singleton
with no cross-process sharing, so going in-process would give this server
its own cold cache on every session, unable to reuse whatever the user's
already-running desktop app (or VS Code extension) has already parsed.
Matches the same "wrap the existing backend over HTTP" integration shape
already proven by the VS Code extension (Milestone 16,
`vscode-extension/src/backend.ts`).
"""
