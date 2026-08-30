"""Entry point for the PyInstaller-frozen backend binary (Milestone 19, Part A).

Imports the FastAPI `app` object directly and hands it to `uvicorn.run`,
rather than the `"semantic_vision.api.app:app"` import-string form `main.py`
uses for local dev with `--reload` -- reload spawns a subprocess that
re-imports the app by module path, which doesn't work once frozen into a
single executable with no importable package on disk. Accepts the same
`--port <port>` flag `vscode-extension/src/backend.ts` already passes to
`uv run uvicorn ...` (Milestone 16), so the frozen binary is a drop-in
replacement for that call.
"""

from __future__ import annotations

import argparse

import uvicorn

from semantic_vision.api.app import app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
