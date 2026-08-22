# Semantic Vision

**See the meaning inside your codebase.**

![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

Semantic Vision parses a Python repository and turns it into an
explorable map of your codebase: an interactive dependency/call graph, a
searchable file tree, and one-click **impact analysis** that shows
everything upstream that would be affected by a change to a given
function — direct callers, transitive callers, and circular call chains,
all highlighted on the graph. It runs entirely on your machine: a small
local backend does the parsing, a local frontend renders it, and nothing
about your code leaves your computer.

![Semantic Vision showing its own persistence module: a sidebar tree, the call graph, and a selected function's details](assets/screenshot.png)

## Features

- **Interactive codebase graph** — directories, files, classes, and
  functions as a zoomable, pannable graph, color-coded by kind, with
  call/import/defines edges and arrowheads.
- **Searchable tree + file scoping** — real-time filtering by name
  across the whole repo, or scope the graph down to a single file's own
  structure.
- **Impact analysis** — right-click any function to see everything
  upstream that calls it, direct vs. transitive, with circular call
  chains flagged rather than silently mishandled, and the whole chain
  highlighted on the graph.
- **Persistent layout** — drag nodes around; positions and analysis
  state are saved locally (inside the inspected repo) and restored the
  next time you open it.
- **Fast, local, and private** — a FastAPI backend statically parses
  your code with Python's own `ast` module (nothing is executed), a
  React frontend renders it. No account, no cloud, no telemetry.

## Status

Semantic Vision is under active development. Here's what works today
and what's still ahead:

| Feature | Status |
|---|---|
| Codebase parsing — imports, classes, functions, call graph | ✅ Available |
| Interactive graph visualization | ✅ Available |
| Searchable file/function tree | ✅ Available |
| Persisted layout & view state | ✅ Available |
| Impact analysis (upstream callers, cycle detection) | ✅ Available |
| AI-generated function documentation | 🚧 Planned |
| Function-level execution flowcharts | 🚧 Planned |
| Docker packaging / one-command setup | 🚧 Planned |
| Multi-language support (beyond Python) | 🚧 Planned |

The parsing layer targets Python today; the graph, API, and persistence
layers are built to stay language-neutral so other languages can plug
in later.

## Quick start

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and Node.js 20+.

```bash
git clone https://github.com/venom21adi/Semantic_Vision.git
cd Semantic_Vision

# Backend — from the repo root
uv sync
uv run uvicorn semantic_vision.api.app:app --port 8000

# Frontend — in a second terminal, from frontend/
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5173`, enter the absolute path to any local
Python repository, and click **Load**.

## How it works

Semantic Vision has two parts:

- **Backend** (`src/semantic_vision/`) — a FastAPI service that walks a
  repository with Python's `ast` module, resolves imports and call sites
  into a graph of nodes and edges, and serves it over a small REST API.
  Parsing is purely static: your code is never executed.
- **Frontend** (`frontend/`) — a React + TypeScript app that renders the
  graph with [`@xyflow/react`](https://reactflow.dev/) and `dagre`
  auto-layout, and persists your layout and saved analysis state in a
  `.visualiser/` folder inside the repo you're inspecting.

## Development

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

## Contributing

Issues and pull requests are welcome. This project is early and moving
fast — for anything beyond a small fix, please open an issue first to
discuss the approach.

## License

MIT — see [LICENSE](LICENSE).
