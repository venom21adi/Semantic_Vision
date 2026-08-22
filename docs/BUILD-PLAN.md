# ACV-AD Build Plan

This document translates the requirements in [ACV-AD Feature Reference](ACV-AD-Feature-Reference.pdf) into an implementation sequence for this repository.

## Product Goal

ACV-AD (Autonomous Codebase Visualiser & Automated Documenter) parses a Python repository and presents its structure, dependencies, call relationships, impact radius, execution flow, and AI-generated function documentation through a local web application.

The first release includes the V1 features in the reference document. Performance prediction, multi-language parsing, team collaboration, and a VS Code extension are explicitly deferred to V2.

## Current Repository State

- `main.py` is currently a minimal Python entry point.
- `pyproject.toml` has no runtime dependencies.
- `README.md` is empty.
- `docs/ACV-AD-Feature-Reference.pdf` is the requirements source.

## Target Architecture

```text
Inspected Python repository
          |
          v
AST ingestion -> symbol table -> resolved graph
          |                         |
          v                         v
   FastAPI API              impact analysis index
          |
          v
React/Vite frontend -> graph canvas, tree, flowchart, panes
          |
          v
.visualiser/ persistence + LiteLLM documentation providers
```

### Backend packages

The backend should be split into focused modules:

- `parser`: file discovery, AST extraction, parse-error handling
- `resolver`: canonical symbols, imports, call-site resolution
- `models`: graph, source, impact, and persistence schemas
- `analysis`: reverse caller index and impact traversal
- `persistence`: `.visualiser/` file storage and restoration
- `api`: FastAPI application and route handlers
- `ai`: constrained context assembly and LiteLLM streaming

### Frontend areas

- Repository loader and parse status
- Searchable repository tree
- Codebase graph canvas
- File-level execution flowchart
- Impact analysis pane
- AI documentation pane
- Source viewer and node context menu
- API client and frontend-ready graph types

## Implementation Sequence

### Milestone 1: Parsing foundation

**Tasks:** TASK-01 and TASK-02

1. Recursively discover Python files.
2. Parse each file with Python's native `ast` module only.
3. Extract directories, files, imports, classes, methods, functions, variables, annotations, line ranges, and call sites.
4. Continue after individual syntax errors and record affected files.
5. Build a global symbol table with canonical IDs:
   `relative/path/file.py::ClassName.method_name`
6. Resolve import aliases and relative imports.
7. Mark standard-library and third-party calls as external.
8. Flag star imports and unresolved calls as ambiguous.
9. Handle circular imports without crashing.

**Validation:** parser fixtures for nested packages, aliases, relative imports, methods, syntax errors, circular imports, star imports, and external calls.

### Milestone 2: Backend API

**Task:** TASK-03

Implement:

- `POST /api/parse-repo`
- `GET /api/graph`
- `GET /api/function-source`

Requirements:

- Validate that the directory exists and is readable.
- Cache parsed repositories by directory path.
- Return node count, edge count, and parse errors.
- Expose nodes with `id`, `kind`, `label`, `file`, `line_start`, and `line_end`.
- Expose directed edges with `source`, `target`, and `kind` (`calls`, `imports`, `defines`).
- Return a clear 404 when a function node does not exist.
- Configure CORS for the Vite development server.

**Validation:** FastAPI tests for successful parsing, invalid paths, cache hits, graph shape, and missing source nodes.

### Milestone 3: Frontend shell and graph

**Tasks:** TASK-04 and TASK-05

1. Create the React/Vite frontend.
2. Use `@xyflow/react` for the graph canvas and `dagre` for initial layout.
3. Add custom node types and colors:
   - Directory: blue
   - File: green
   - Class: purple
   - Function: orange
4. Add arrowheads, drag, zoom, pan, fit view, minimap, and dot-grid background.
5. Select nodes to synchronize the sidebar and right-side panes.
6. Double-click a node to fit its immediate neighborhood.
7. Show a warning when the graph exceeds 300 nodes.
8. Add the right-click menu for Document, Impact Analysis, and View Source.

**Validation:** frontend component tests plus manual desktop and mobile checks for selection, graph controls, context-menu dismissal, and large graphs.

### Milestone 4: Sidebar and persistence

**Tasks:** TASK-06 and TASK-10

1. Add an absolute-path repository loader with spinner, success stats, and collapsible parse errors.
2. Persist the last-used path in `localStorage`.
3. Add a directory/file/function tree.
4. Collapse directories with more than five children by default.
5. Add real-time filtering by file and function name with match count and Escape/clear support.
6. Add Codebase/File segmented view toggle.
7. Implement `.visualiser/` storage:
   - `graph_state.json`
   - `metadata.json`
   - `docs/{hash}.md`
   - `docs/index.json`
8. Restore node positions and generated documentation on repository load.
9. Auto-save moved node positions every 60 seconds.

**Validation:** persistence round-trip tests, tree filtering tests, local-storage tests, and reload behavior checks.

### Milestone 5: Impact analysis

**Task:** TASK-07

1. Build a reverse caller index once after parsing.
2. Traverse upstream callers with breadth-first search.
3. Separate direct callers from transitive callers.
4. Support configurable `max_depth`, defaulting to 5.
5. Detect circular call chains without crashing.
6. Return the target, caller groups, call-chain edges, and cycle information.
7. Add the impact pane with clickable callers and graph highlighting.

**Validation:** direct caller, multi-hop, no-caller, depth-limit, and circular-chain tests in both backend and frontend layers.

### Milestone 6: AI documentation

**Task:** TASK-08

1. Assemble constrained context containing:
   - Target function source
   - Direct callee signatures
   - Direct caller signatures
   - Parent class definition when applicable
2. Enforce an approximately 2,000-token context ceiling.
3. Integrate LiteLLM providers:
   - Ollama with `llama3`
   - OpenAI with `gpt-4o-mini`
   - Anthropic with `claude-haiku-4-5`
4. Stream structured Markdown with sections for Purpose, Parameters, Returns, Side Effects, and Notes.
5. Add provider selection, regeneration, Markdown rendering, syntax highlighting, save, empty, and error states.
6. Persist saved documentation under `.visualiser/docs/`.

**Validation:** context-size tests, mocked provider streaming tests, provider failure tests, Markdown rendering tests, and save/reload tests.

### Milestone 7: File-level execution flowchart

**Task:** TASK-09

1. Build an internal control-flow representation from the selected function AST.
2. Render entry and return nodes, assignments and calls, decisions, loops, I/O, and defined sub-process calls.
3. Use conventional shapes and `Yes`/`No` decision labels.
4. Add loop back-edges and source-line tooltips.
5. Use top-to-bottom `dagre` layout and the same dark visual language as the graph.

**Validation:** fixtures for branches, nested branches, loops, returns, I/O, and nested defined-function calls.

### Milestone 8: Packaging and documentation

**Task:** TASK-11

1. Add separate FastAPI and React/Vite services.
2. Make `docker compose up` start the complete stack.
3. Serve the frontend at `http://localhost:5173` and backend at `http://localhost:8000`.
4. Pass AI keys through environment variables only.
5. Add `.env.example` and ignore `.env`.
6. Mount inspected repositories read-only into the backend.
7. Write a product-focused README with a screenshot, three-command quick start, Ollama setup, stack summary, and contribution guide.

**Validation:** clean-machine Docker smoke test, API health check, frontend load check, and repository mount/parse check.

## API Contracts

### Graph node

```json
{
  "id": "src/service.py::Service.run",
  "kind": "function",
  "label": "run",
  "file": "src/service.py",
  "line_start": 10,
  "line_end": 24
}
```

### Graph edge

```json
{
  "source": "src/main.py::main",
  "target": "src/service.py::Service.run",
  "kind": "calls"
}
```

The graph model should remain language-neutral enough for V2, but the first parser implementation should be Python-specific and use a clear parser boundary.

## Docker Path Convention

The UI accepts a repository path, but a container cannot directly access arbitrary host paths. The initial Compose workflow should document a mounted path convention:

- Mount the inspected host repository at `/workspace/repo`.
- Send `/workspace/repo` to the backend from the frontend.
- Keep the mount read-only for source inspection; persistence requires a deliberate writable `.visualiser/` strategy.

Before packaging, decide whether `.visualiser/` is written through a separate writable mount or whether the full repository mount is writable. This decision affects the persistence acceptance tests.

## Cross-Cutting Quality Requirements

- Use type hints and Pydantic schemas at API boundaries.
- Keep parsing deterministic and independent of the AI provider.
- Never let one invalid source file abort a repository parse.
- Keep unresolved symbols visible and explainable rather than silently dropping them.
- Keep AI context assembly separate from provider transport.
- Add tests alongside each milestone instead of deferring all coverage.
- Exclude V2 features from the V1 implementation and UI.

## First Implementation Slice

Start with TASK-01: define the internal AST data models, parse a target directory, and expose a deterministic JSON result. The cheapest success check is a fixture repository containing one module, one class method, one imported function, and one unresolved external call; its expected symbols and call edges should be asserted exactly.
