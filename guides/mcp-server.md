# Using the MCP server

A walkthrough of `semantic-vision-mcp`: what it exposes, how to point an
agent at it, and how it shares state with the desktop app and VS Code
extension. See the [main README](../README.md#-mcp-server-for-coding-agents)
for the short version; this is the long one.

## What it is

`semantic-vision-mcp` is an [MCP](https://modelcontextprotocol.io) server
that wraps the same FastAPI backend the web app and VS Code extension already
talk to — no separate analysis engine, no new schemas. It gives a coding
agent (Claude Code, Claude Desktop, Cursor, or anything else that speaks MCP)
the same structural facts you'd otherwise click around the graph for: call
graph, impact analysis, complexity, git-aware hotspot and diff scoring, and
column-level data lineage — as tool calls it can make mid-conversation
instead of grepping and guessing.

It talks to the backend over plain HTTP, the same way the VS Code extension
does, rather than importing backend code into its own process. That's a
deliberate choice, not an implementation detail: the backend's cache is a
plain in-memory, per-process singleton, so if you already have the desktop
app or VS Code extension open with a repo parsed, the MCP server reuses that
exact warm cache instead of re-parsing from cold. If nothing is running yet,
it spawns its own backend on `127.0.0.1:8000` and tears it down when it exits.

## Install and run

```bash
uv sync
uv run semantic-vision-mcp
```

That's the whole install — it's a console-script entry point defined in this
project's `pyproject.toml`, so once dependencies are synced it's just a
command an MCP client can launch. It speaks stdio, the standard transport for
a locally-run MCP server talking to a locally-run client.

To point an MCP-compatible client at it, add it as a stdio server. For
Claude Code:

```bash
claude mcp add semantic-vision -- uv --directory /path/to/Semantic_Vision run semantic-vision-mcp
```

For Claude Desktop, or any client configured via JSON, add an entry like:

```json
{
  "mcpServers": {
    "semantic-vision": {
      "command": "uv",
      "args": ["--directory", "/path/to/Semantic_Vision", "run", "semantic-vision-mcp"]
    }
  }
}
```

Already have a backend running yourself (`uv run uvicorn
semantic_vision.api.app:app --port 8000`, or the desktop app, or the VS Code
extension's bundled one)? The MCP server detects it's reachable at
`127.0.0.1:8000` and reuses it — it never spawns a second backend on top of
one that's already there, and never kills one it didn't start. To point it
at a different host or port, set `SEMANTIC_VISION_BACKEND_HOST` /
`SEMANTIC_VISION_BACKEND_PORT` before launching. For safety, the server only
ever *spawns* a backend bound to a loopback address (`127.0.0.1`/`localhost`)
— spawning the full backend, write-capable routes included, on a
non-loopback host it doesn't control would be a bigger blast radius than one
tool call should trigger silently.

## Tools

Every tool below except `parse_repo` requires `parse_repo` to have been
called first for that `path` — exactly like the REST API and web app, no
tool silently auto-parses on a cache miss. Re-parsing an already-parsed path
picks up on-disk changes since the last parse.

| Tool | What it answers |
|---|---|
| `parse_repo(path, language, doc_root)` | Parses and caches a repo. Required first for every other tool below. |
| `get_graph(path, max_nodes)` | The full parsed structure — every node and edge. Truncated past `max_nodes` (default 500) to avoid flooding context with a repo-sized dump; prefer a targeted tool below for a single function. |
| `get_impact(path, id, max_depth)` | Upstream blast radius: everything that directly or transitively depends on `id`. |
| `get_callees(path, id)` | The opposite direction — what `id` itself directly calls. |
| `get_complexity(path)` | Per-function cyclomatic complexity, call-chain depth, nested-loop flag. |
| `get_complexity_diff(path)` | Complexity now vs. the last time it was computed for this path. |
| `get_complexity_diff_ref(path, ref, to_ref, language)` | Complexity diffed against a specific commit/branch, or between two arbitrary refs — "did this change make the code healthier or worse." Runs in a scratch git worktree; never touches your working tree. |
| `get_hotspots(path, window_days)` | Functions ranked by complexity × how often their file has changed in git history — a practical risk signal, not just a static one. |
| `get_dead_code(path)` | Functions with zero callers anywhere in the graph, after excluding decorated functions, test files/names, dunder methods, and `main` entry points — candidates to review, not a verdict. |
| `ingest_coverage(path, coverage_path)` | Reads a coverage.py XML or lcov report your own test-runner already produced. Required once before `get_coverage_risk` returns real data. |
| `get_coverage_risk(path)` | Functions ranked by complexity × (1 + blast radius) × (1 − test coverage) — where correctness risk actually concentrates, combining three numbers no other single tool here reports together. |
| `get_duplicates(path)` | Functions whose structure is identical once every identifier name, literal value, and comment is stripped — a maintenance-cost signal complexity alone can't see. Exact-shape matches only, not near-misses. |
| `get_git_refs(path)` | Local branches and recent commits, for picking a `ref` to diff against. |
| `get_flowchart(path, id)` | Control-flow breakdown of one function's body — branches, loops, early returns. |
| `get_function_source(path, id)` | The exact source text of one function or file, read by its recorded line range. |

`id` is a node ID from `get_graph`'s output (or from a prior tool call's
result) — the same IDs the web app and VS Code extension use internally.

## What's deliberately not exposed

Routes that mutate state or stream rather than answer a question are left
out on purpose: saved layout/doc state, the dbt/live-database ingestion
endpoints (connecting external systems isn't "answer a question about the
code"), and AI doc generation (streaming, and a different kind of tool call
than the structural facts above). Column-level lineage isn't a separate
tool either — it's already inside `get_graph`/`get_callees` as `Table`/
`Column`/`DBT_MODEL` nodes and `references`/`materializes`/`foreign_key`
edges, exactly how the web app itself renders it.

Dependency/security risk scanning (the web app's "Dependencies" tab) is
deliberately not exposed here either, unlike every other Code Health
signal above: it's the one feature in this project that makes a live
outbound network call (to [osv.dev](https://osv.dev)), gated behind an
explicit, per-request consent field the REST API itself enforces
server-side. An agent silently triggering a real network call needs its
own consent design — not assumed away by wrapping it as one more tool
call — so it stays a web-app-only feature for now.
