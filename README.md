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
- **AI-generated documentation** — right-click any function to generate
  Markdown docs (Purpose, Parameters, Returns, Side Effects, Notes) from
  its source plus its direct callers/callees and parent class, streamed
  live from your choice of provider — a local [Ollama](https://ollama.com)
  model, OpenAI, or Anthropic — and saved back into the repo.
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
| AI-generated function documentation | ✅ Available |
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

## AI documentation setup

Right-click any function and choose **Document** to generate Markdown
docs for it. Pick a provider in the panel that opens — no extra setup is
required to try it, but each provider needs one of the following before
generation will work:

- **Ollama** (local, free, private) — install [Ollama](https://ollama.com),
  run `ollama serve`, and pull one or more models, e.g.
  `ollama pull llama3.2:3b`. The panel lists whatever you've actually
  pulled and lets you pick which one to use per generation — handy for
  swapping in a lighter model for quick testing. The backend talks to
  Ollama at `http://localhost:11434` by default.
- **OpenAI** — set an `OPENAI_API_KEY` environment variable before
  starting the backend. Uses `gpt-4o-mini` by default.
- **Anthropic** — set an `ANTHROPIC_API_KEY` environment variable before
  starting the backend. Uses `claude-haiku-4-5` by default.

OpenAI's and Anthropic's default model names can be overridden with
`SEMANTIC_VISION_OPENAI_MODEL` / `SEMANTIC_VISION_ANTHROPIC_MODEL`; for
Ollama, use the model picker in the panel instead. Generated docs are
only written to disk when you click **Save** — nothing is persisted
automatically.

## How it works

Semantic Vision has two parts:

- **Backend** (`src/semantic_vision/`) — a FastAPI service that walks a
  repository with Python's `ast` module, resolves imports and call sites
  into a graph of nodes and edges, and serves it over a small REST API.
  Parsing is purely static: your code is never executed. AI
  documentation is generated separately, on demand, via
  [LiteLLM](https://docs.litellm.ai/) against whichever provider you
  pick — only the target function's source, its direct callers/callees'
  signatures, and its parent class header are sent, never the whole
  repository.
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
