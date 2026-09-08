"""Entrypoint for `semantic-vision-mcp` (see `pyproject.toml`'s
`[project.scripts]`) / `python -m semantic_vision.mcp_server`.
"""

from __future__ import annotations

import asyncio
import os

from semantic_vision.mcp_server.client import DEFAULT_HOST, DEFAULT_PORT, BackendClient
from semantic_vision.mcp_server.server import build_server


async def _run() -> None:
    host = os.environ.get("SEMANTIC_VISION_BACKEND_HOST", DEFAULT_HOST)
    port = int(os.environ.get("SEMANTIC_VISION_BACKEND_PORT", str(DEFAULT_PORT)))
    client = BackendClient(host=host, port=port)
    try:
        await client.ensure_running()
        mcp = build_server(client)
        await mcp.run_stdio_async()
    finally:
        await client.aclose()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
