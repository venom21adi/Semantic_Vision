# Semantic Vision

Semantic Vision parses a source repository and presents its structure,
dependencies, call relationships, impact radius, execution flow, and
AI-generated function documentation through a local web application. The
parsing layer targets Python first; the graph, API, and persistence layers
are built to stay language-neutral so other languages can plug in later.

See `docs/BUILD-PLAN.md` for the full implementation sequence and API
contracts. `docs/` and `.claude/` are local-only (listed in
`.gitignore`, not tracked in git), so a fresh clone of this repo won't
include them — see whoever shared the repo with you for a copy if you
don't already have one.

## Status

**Milestones 1-4 are implemented and tested** — parsing, the backend API,
the frontend graph, and sidebar/persistence.

### Milestone 1: Parsing foundation (`src/semantic_vision/`)

- Recursive Python file discovery (`parser/discovery.py`), tolerant of
  per-file syntax errors.
- AST extraction of directories, files, imports, classes, methods,
  functions, variables, and call sites (`parser/extractor.py`), including
  defs nested under `if`/`for`/`try`/`with`/`match` and through arbitrary
  depths of closures.
- Canonical symbol table with ids like `path/file.py::Class.method`
  (`resolver/symbol_table.py`).
- Import resolution — absolute, relative, star — distinguishing local,
  external, and ambiguous targets (`resolver/imports.py`).
- Call-site resolution — same-file, `self`/`cls`, imported symbols,
  multi-hop dotted chains, builtins, decorators — down to `calls` edges
  marked `external`/`ambiguous` where relevant (`resolver/calls.py`).
- `repo_parser.parse_repository()` orchestrates the above into a
  deterministic, sorted `ParseResult`.

### Milestone 2: Backend API (`src/semantic_vision/api/`)

- FastAPI app (`api/app.py`) with CORS for the Vite dev server.
- `POST /api/parse-repo`, `GET /api/graph`, `GET /api/function-source`,
  with directory-existence/readability validation and a per-path
  in-memory cache (`api/cache.py`) so repeated `GET`s skip re-parsing.

### Milestone 3: Frontend shell and graph (`frontend/src/graph/`)

- React 19 + Vite + TypeScript frontend rendering the parsed graph with
  `@xyflow/react` and `dagre` auto-layout (`graph/layout.ts`).
- Colored node types — directory/file/class/function — with arrowheads,
  drag/zoom/pan/fit-view, minimap, and dot-grid background
  (`graph/nodeTypes.tsx`).
- Node selection synced to a details panel; double-click fits a node's
  neighborhood; a warning banner above 300 nodes.
- Right-click context menu for Document / Impact Analysis / View Source
  (`graph/ContextMenu.tsx`); View Source is fully wired to the backend.

### Milestone 4: Sidebar and persistence (`src/semantic_vision/persistence/`, `frontend/src/tree/`)

- Repository loader with spinner, success stats, and collapsible parse
  errors; last-used path remembered via `localStorage`.
- Directory/file/class/function tree with real-time filtering (match
  count, Escape/clear) and a Codebase/File view toggle.
- `.visualiser/` persistence — `graph_state.json`, `metadata.json`,
  `docs/index.json`, `docs/{hash}.md` — written atomically (temp file +
  rename) with merge-on-save semantics so a scoped view (e.g. File view)
  can't clobber other nodes' saved positions.
- Node positions and saved documentation restored on repo load; dragged
  positions auto-saved every 60 seconds, plus a flush on view switch.

Not yet started: **Milestone 5** (impact analysis), **Milestone 6** (AI
documentation), **Milestone 7** (execution flowchart), **Milestone 8**
(Docker packaging).

Current test status: 43 backend tests (`uv run pytest -q`) and 79
frontend tests (`npm run test -- --run`), both green; `uv run ruff check .`
and the frontend's `tsc`/oxlint checks are clean.

## Next steps

Per the build plan's milestone order:

1. **Milestone 5 — Impact analysis** (`TASK-07`): reverse caller index,
   breadth-first upstream traversal with configurable `max_depth` and
   cycle detection, and an impact pane with clickable callers and graph
   highlighting.
2. **Milestone 6 — AI documentation** (`TASK-08`): constrained-context
   assembly, LiteLLM provider integration (Ollama/OpenAI/Anthropic),
   streamed Markdown documentation with save/regenerate.
3. **Milestone 7 — File-level execution flowchart** (`TASK-09`):
   control-flow representation and rendering for a selected function.
4. **Milestone 8 — Packaging and documentation** (`TASK-11`): Docker
   Compose for both services and a product-focused README.

## Development

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/) for the
backend, and Node.js for the frontend.

```bash
# Backend
uv sync
uv run pytest -q
uv run ruff check .

# Frontend (from frontend/)
npm install
npm run test -- --run
npm run dev
```
