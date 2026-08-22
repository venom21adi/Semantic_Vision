# ACV-AD

Autonomous Codebase Visualiser & Automated Documenter. ACV-AD parses a Python
repository and presents its structure, dependencies, call relationships,
impact radius, execution flow, and AI-generated function documentation
through a local web application.

See [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) for the full implementation
sequence and API contracts.

## Status

**Milestone 1: Parsing foundation** (`src/acv_ad/`) is implemented and tested.

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

Everything else in the build plan — the FastAPI backend, the React
frontend, persistence, impact analysis, AI documentation, the execution
flowchart, and Docker packaging — is not yet started.

## Next steps

Per the build plan's milestone order:

1. **Milestone 2 — Backend API** (`TASK-03`): wrap `parse_repository` in a
   FastAPI app exposing `POST /api/parse-repo`, `GET /api/graph`, and
   `GET /api/function-source`, with directory validation, per-path caching,
   and CORS for the Vite dev server.
2. **Milestone 3 — Frontend shell and graph** (`TASK-04`/`TASK-05`): scaffold
   the React/Vite frontend and render the parsed graph with `@xyflow/react`
   + `dagre`.
3. **Milestone 4 — Sidebar and persistence** (`TASK-06`/`TASK-10`):
   repository loader, searchable tree, and `.visualiser/` persistence.
4. Milestones 5-8: impact analysis, AI documentation, the file-level
   execution flowchart, and Docker packaging.

## Development

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run pytest -q
uv run ruff check .
```
