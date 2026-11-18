"""Smoke-test the frozen binary's MCP mode over real stdio: initialize, list tools, parse a repo.
Usage: python smoke_mcp.py <binary> <repo-dir> [port]   (needs the `mcp` package)."""
from __future__ import annotations

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(binary: str, repo: str, port: str) -> None:
    env = dict(os.environ)
    env.update({"SEMANTIC_VISION_BACKEND_HOST": "127.0.0.1", "SEMANTIC_VISION_BACKEND_PORT": port})
    params = StdioServerParameters(command=binary, args=["--mcp"], env=env)
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = (await session.list_tools()).tools
        assert len(tools) >= 10, f"expected the full tool set, got {len(tools)}"
        parsed = await session.call_tool("parse_repo", {"path": repo})
        assert not parsed.is_error, parsed.content[0].text
        summary = json.loads(parsed.content[0].text)
        assert summary["node_count"] > 0, summary
        print(f"MCP smoke OK: {len(tools)} tools, parsed {summary['node_count']} nodes")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "8124"))
