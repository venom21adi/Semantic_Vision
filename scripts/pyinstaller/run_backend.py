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
    parser.add_argument(
        "--mcp",
        action="store_true",
        help="Run the MCP server (stdio) instead of the HTTP backend. It reuses a backend already "
        "listening on SEMANTIC_VISION_BACKEND_HOST/PORT (default 127.0.0.1:8000) or starts one.",
    )
    args = parser.parse_args()
    if args.mcp:
        from semantic_vision.mcp_server.__main__ import main as mcp_main

        mcp_main()
        return
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
