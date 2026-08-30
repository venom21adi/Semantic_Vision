# Semantic Vision

Interactive call graph, impact analysis, and AI-generated docs for your
codebase, right inside the editor — the same engine as the
[Semantic Vision](https://github.com/venom21adi/Semantic_Vision) web app, as
a panel next to your code instead of a separate browser tab.

![Exploring Semantic Vision's own flowchart module: selecting a function, dragging it, then running impact analysis to highlight its real callers on the graph](https://raw.githubusercontent.com/venom21adi/Semantic_Vision/main/assets/interactive-call-graph.gif)

## What it does

- **Open Graph** (`semanticVision.openGraph`) — opens the full call graph in
  a panel, centered on whichever file is active in the editor. Click any
  node to jump straight to that function or class in your code.
- **Impact Analysis at Cursor** (`semanticVision.impactAnalysisAtCursor`,
  also on the editor right-click menu) — resolves your cursor position to a
  graph node and highlights every direct and transitive caller, so you can
  see a change's real blast radius without leaving your place in the file.

Everything else the graph supports — execution flowcharts, the complexity
report, AI-generated documentation, code-to-data lineage — is available from
the same panel once it's open, unchanged from the web app.

## Requirements

This extension is a thin client: it renders the same frontend as the web
app, backed by a local FastAPI server that does the actual parsing.

- **`semanticVision.backendUrl`** (default `http://localhost:8000`) — where
  that server is expected to answer. If something is already running there
  (e.g. via `docker compose up`, see the main project's
  [README](https://github.com/venom21adi/Semantic_Vision#readme)), the
  extension uses it as-is.
- **`semanticVision.backendPath`** — optionally, an absolute path to a local
  Semantic Vision checkout (the directory containing `pyproject.toml`).
  When set, the extension starts the backend for you with
  `uv run uvicorn semantic_vision.api.app:app`, the same command the project
  documents for local development. This requires
  [`uv`](https://docs.astral.sh/uv/) on `PATH` and a prior `uv sync` in that
  checkout.

Nothing about your code is ever executed or sent anywhere — parsing is
static, and the backend runs entirely on your own machine.

## Getting started

1. Install this extension.
2. Either start the backend yourself (`uv run uvicorn
   semantic_vision.api.app:app` from a Semantic Vision checkout, or `docker
   compose up`), or set `semanticVision.backendPath` to have the extension
   start it automatically.
3. Open a file in a supported repository (Python, or JavaScript/TypeScript)
   and run **Semantic Vision: Open Graph** from the Command Palette.

## Learn more

Full documentation, screenshots, and setup guides (AI provider setup,
code-to-data lineage, multi-language support) live in the main project's
[README](https://github.com/venom21adi/Semantic_Vision#readme) and
[guides/](https://github.com/venom21adi/Semantic_Vision/tree/main/guides)
directory.
