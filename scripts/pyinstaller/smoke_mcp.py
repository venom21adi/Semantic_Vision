"""Smoke-test the frozen binary's MCP mode over real stdio: initialize, list tools, parse a repo.
Usage: python smoke_mcp.py <binary> <repo-dir> [port] [language [node-id [source>target]]]
(needs the `mcp` package). With a language, the repo is parsed as that language; the given node
must exist, and the given edge (if any) must be in the graph -- or must be absent, if written
`!source>target`. (`get_graph` omits edges to `external::` targets, so a library call can only be
checked by the absence of the wrong repo-internal edge.)"""
from __future__ import annotations

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(
    binary: str,
    repo: str,
    port: str,
    language: str | None,
    expected: str | None,
    edge: str | None,
) -> None:
    env = dict(os.environ)
    env.update({"SEMANTIC_VISION_BACKEND_HOST": "127.0.0.1", "SEMANTIC_VISION_BACKEND_PORT": port})
    params = StdioServerParameters(command=binary, args=["--mcp"], env=env)
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = (await session.list_tools()).tools
        assert len(tools) >= 10, f"expected the full tool set, got {len(tools)}"
        args = {"path": repo} | ({"language": language} if language else {})
        parsed = await session.call_tool("parse_repo", args)
        assert not parsed.is_error, parsed.content[0].text
        summary = json.loads(parsed.content[0].text)
        assert summary["node_count"] > 0, summary
        if expected:
            graph = await session.call_tool("get_graph", {"path": repo, "max_nodes": 100000})
            body = json.loads(graph.content[0].text)
            ids = {n["id"] for n in body["nodes"]}
            assert expected in ids, f"{expected!r} missing from the parsed graph"
            if edge:
                want_absent = edge.startswith("!")
                source, _, target = edge.removeprefix("!").partition(">")
                pairs = {(e["source"], e["target"]) for e in body["edges"]}
                if want_absent:
                    assert (source, target) not in pairs, f"edge {edge[1:]!r} must not exist"
                else:
                    assert (source, target) in pairs, f"edge {edge!r} missing from the graph"
        print(f"MCP smoke OK: {len(tools)} tools, parsed {summary['node_count']} nodes")


if __name__ == "__main__":
    argv = sys.argv
    asyncio.run(
        main(
            argv[1],
            argv[2],
            argv[3] if len(argv) > 3 else "8124",
            argv[4] if len(argv) > 4 else None,
            argv[5] if len(argv) > 5 else None,
            argv[6] if len(argv) > 6 else None,
        )
    )
