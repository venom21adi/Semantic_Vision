# Semantic Vision

**See what an AI agent's edit — or your own — will break, before you merge it.**

Impact analysis, an interactive call graph, execution flowcharts, complexity
reports, AI-generated documentation, and code-to-data lineage, right inside
the editor — the same engine as the
[Semantic Vision](https://github.com/venom21adi/Semantic_Vision) web app, as
a panel next to your code instead of a separate browser tab.

![Impact analysis run on a real 6,650-node repository: clicking a caller brings it onto the graph, highlighted, while a circular call chain gets flagged automatically](https://raw.githubusercontent.com/venom21adi/Semantic_Vision/main/assets/impact-analysis-demo.gif)

## Impact analysis

Right-click any function — or, with code-to-data lineage connected, any
table or column — and choose **Impact Analysis** to see every direct and
transitive caller, resolved from the real call graph, not a guess. Circular
call chains are flagged instead of silently mishandled, and the whole blast
radius highlights live on the graph. This is the answer to "what actually
depends on this" before you merge a change, not after something breaks in
production.

- **Semantic Vision: Open Graph** (`semanticVision.openGraph`) — opens the
  full call graph in a panel, centered on whichever file is active in the
  editor. Click any node to jump straight to that function or class in your
  code.
- **Semantic Vision: Impact Analysis at Cursor**
  (`semanticVision.impactAnalysisAtCursor`, also on the editor's right-click
  menu) — resolves your cursor position to a graph node and highlights its
  full blast radius without leaving your place in the file.

## Everything else, in the same panel

Once the graph is open, every other feature works exactly as it does in the
web app:

- **Interactive call graph** — every directory, file, class, and function as
  a zoomable, color-coded graph with call/import/defines edges, plus
  real-time search across the whole repo or scoped to one file. Dragged
  layout and analysis state persist automatically.
- **Execution flowcharts** — right-click any function for its execution
  flowchart, built from its real AST/CST: entry and return points, decisions
  with Yes/No edges, loops with a visible back-edge, I/O calls, and calls out
  to other functions. Works for both Python and JS/TS, including `switch`
  fallthrough, `do...while`'s bottom-condition check, and labeled
  `break`/`continue`.
- **Code Health** — a peer lens to the codebase graph, switched via a
  header tab: a filterable, sortable ranked list across three tabs
  (Complexity, computed from a real AST walk; Hotspots, complexity ×
  how often a file actually changes; Dead code, zero-caller candidates).
  Click any row to see exactly who calls it and what it calls, live.
- **AI-generated documentation** — right-click any function and choose
  **Document** to stream real Markdown documentation (Purpose, Parameters,
  Returns, Side Effects, Notes) assembled from its actual source, callers,
  callees, and parent class. Right-click a file for a module-level summary.
  Pick a local [Ollama](https://ollama.com) model (free, nothing leaves your
  machine), OpenAI, or Anthropic — nothing is saved until you click **Save**.
- **Code-to-data lineage** — SQLAlchemy models are detected automatically on
  every parse; connect a dbt `manifest.json` and/or a live database
  connection string to add their tables, models, and columns to the same
  graph, reconciled by name. Flip **Data only** to read it as a pure lineage
  diagram, with impact analysis spanning code and data in one traversal.

## Requirements

This extension is a thin client: it renders the same frontend as the web
app, backed by a FastAPI server that does the actual parsing.

- **Zero setup (default)** — on Windows, macOS (Intel and Apple Silicon), and
  Linux, the backend ships bundled inside the extension and starts
  automatically the first time you run a command. No Python, no `uv`,
  nothing beyond VS Code itself.
- **`semanticVision.backendUrl`** (default `http://localhost:8000`) — where
  the backend is expected to answer. If something is already running there
  (e.g. via `docker compose up`, see the main project's
  [README](https://github.com/venom21adi/Semantic_Vision#readme)), the
  extension uses it as-is instead of starting its own.
- **`semanticVision.backendPath`** — optionally, an absolute path to a local
  Semantic Vision checkout (the directory containing `pyproject.toml`). When
  set, the extension starts the backend from source with
  `uv run uvicorn semantic_vision.api.app:app` instead of the bundled binary
  — useful for contributors working against an unreleased backend change.
  Requires [`uv`](https://docs.astral.sh/uv/) on `PATH` and a prior
  `uv sync` in that checkout.

Nothing about your code is ever executed or sent anywhere — parsing is
static, and the backend runs entirely on your own machine. Nothing leaves it
unless you explicitly ask for AI-generated docs from a cloud provider.

## Getting started

1. Install this extension.
2. Open a file in a supported repository (Python, JavaScript/TypeScript, or Java).
3. Run **Semantic Vision: Open Graph** from the Command Palette, or
   right-click a function and choose **Semantic Vision: Impact Analysis at
   Cursor**. The bundled backend starts automatically — no extra setup.

## Learn more

Full documentation, screenshots, and setup guides (AI provider setup,
code-to-data lineage, multi-language support) live in the main project's
[README](https://github.com/venom21adi/Semantic_Vision#readme) and
[guides/](https://github.com/venom21adi/Semantic_Vision/tree/main/guides)
directory.
