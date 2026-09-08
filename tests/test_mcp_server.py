import asyncio
import subprocess
from pathlib import Path

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ToolError

import semantic_vision.api.routes as routes_module
from semantic_vision.api.app import app
from semantic_vision.api.cache import cache
from semantic_vision.mcp_server.client import BackendClient, BackendError, _extract_detail
from semantic_vision.mcp_server.server import DEFAULT_MAX_GRAPH_NODES, build_server

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _no_git_root_detection(monkeypatch):
    """Same rationale as `tests/test_api.py`'s identical fixture: fixture
    repos live inside this project's own git repo, so real ancestor-`.git`
    detection would resolve every fixture parse to this project's own
    root instead of the fixture's own directory."""

    def _identity_resolve(parsed_root: Path, requested: str | None) -> Path:
        return Path(requested).resolve() if requested else parsed_root.resolve()

    monkeypatch.setattr(routes_module.persistence, "resolve_doc_root", _identity_resolve)


def _run(coro):
    return asyncio.run(coro)


def _server():
    """A fresh `MCPServer` per test, backed by the real FastAPI app over
    `httpx.ASGITransport` -- no real subprocess or port binding, matching
    `test_api.py`'s own `TestClient`-based integration-test style rather
    than inventing a new one."""
    transport = httpx.ASGITransport(app=app)
    client = BackendClient(transport=transport)
    return build_server(client)


async def _parse_simple_repo(mcp) -> None:
    await mcp.call_tool("parse_repo", {"path": str(FIXTURES / "simple_repo")})


def test_parse_repo_then_get_complexity():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_complexity", {"path": str(FIXTURES / "simple_repo")}
        )
        return result.structured_content

    body = _run(scenario())
    node_ids = {score["node_id"] for score in body["scores"]}
    assert "app.py::Greeter.greet" in node_ids


def test_get_graph_returns_the_parsed_nodes_and_edges():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool("get_graph", {"path": str(FIXTURES / "simple_repo")})
        return result.structured_content

    body = _run(scenario())
    assert body["truncated"] is False
    assert body["total_node_count"] == len(body["nodes"])
    assert any(n["id"] == "app.py::Greeter.greet" for n in body["nodes"])


def test_get_graph_truncates_past_max_nodes_and_reports_it():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_graph", {"path": str(FIXTURES / "simple_repo"), "max_nodes": 2}
        )
        return result.structured_content

    body = _run(scenario())
    assert body["truncated"] is True
    assert len(body["nodes"]) == 2
    assert body["total_node_count"] > 2
    # Every returned edge's endpoints must be among the kept (truncated) nodes.
    kept_ids = {n["id"] for n in body["nodes"]}
    assert all(e["source"] in kept_ids and e["target"] in kept_ids for e in body["edges"])


def test_get_graph_default_max_nodes_matches_module_constant():
    assert DEFAULT_MAX_GRAPH_NODES == 500


def test_get_impact_reports_the_direct_caller():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_impact",
            {"path": str(FIXTURES / "simple_repo"), "id": "helpers.py::format_name"},
        )
        return result.structured_content

    body = _run(scenario())
    assert body["target"] == "helpers.py::format_name"
    caller_ids = {c["id"] for c in body["callers"]}
    assert "app.py::Greeter.greet" in caller_ids


def test_get_callees_reports_the_outgoing_call_not_the_incoming_one():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_callees",
            {"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"},
        )
        return result.structured_content

    body = _run(scenario())
    assert body["target"] == "app.py::Greeter.greet"
    callee_ids = {c["id"] for c in body["callees"]}
    assert callee_ids == {"helpers.py::format_name"}


def test_get_callees_reports_nothing_for_a_leaf_function():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_callees",
            {"path": str(FIXTURES / "simple_repo"), "id": "helpers.py::format_name"},
        )
        return result.structured_content

    body = _run(scenario())
    assert body["callees"] == []


def test_get_complexity_diff_ref_against_an_older_commit(tmp_path: Path):
    import subprocess

    def git(args: list[str]) -> None:
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True)

    git(["init"])
    git(["config", "user.email", "test@example.com"])
    git(["config", "user.name", "Test"])
    (tmp_path / "app.py").write_text("def f():\n    return 1\n", encoding="utf-8")
    git(["add", "-A"])
    git(["commit", "-m", "baseline"])
    (tmp_path / "app.py").write_text(
        "def f():\n    if True:\n        return 1\n    return 2\n", encoding="utf-8"
    )

    async def scenario():
        mcp = _server()
        await mcp.call_tool("parse_repo", {"path": str(tmp_path)})
        result = await mcp.call_tool(
            "get_complexity_diff_ref", {"path": str(tmp_path), "ref": "HEAD"}
        )
        return result.structured_content

    body = _run(scenario())
    assert body["ref"] == "HEAD"
    assert body["available"] is True
    changed_ids = {c["node_id"] for c in body["changed"]}
    assert "app.py::f" in changed_ids


def test_tool_call_before_parse_repo_raises_a_clear_backend_error():
    # `BackendError` (a `ToolError` subclass) is what `client.py` raises,
    # but the SDK's own tool-execution layer wraps a deliberate `ToolError`
    # in a fresh `ToolError` carrying the original message as its suffix
    # (see `Tool.run`'s docstring: "an anticipated failure keeps its own
    # text after the prefix") rather than re-raising it unchanged -- so the
    # outer type observed here is the SDK's `ToolError`, not `BackendError`
    # itself. Still confirms `BackendError`'s message reaches this boundary
    # intact.
    async def scenario():
        mcp = _server()
        await mcp.call_tool("get_complexity", {"path": str(FIXTURES / "simple_repo")})

    with pytest.raises(ToolError, match="not parsed yet"):
        _run(scenario())


def test_get_hotspots_reports_is_git_repo_false_outside_any_git_repo(tmp_path: Path):
    # Deliberately `tmp_path`, not `FIXTURES / "simple_repo"` -- the fixture
    # repos live inside this project's own git repo, so ancestor `.git`
    # detection (`git_ops.find_git_root`) would find *this* repo's root and
    # report `is_git_repo: True`, same reasoning `test_api.py`'s equivalent
    # test already applies.
    (tmp_path / "app.py").write_text("def f():\n    return 1\n", encoding="utf-8")

    async def scenario():
        mcp = _server()
        await mcp.call_tool("parse_repo", {"path": str(tmp_path)})
        result = await mcp.call_tool("get_hotspots", {"path": str(tmp_path)})
        return result.structured_content

    body = _run(scenario())
    assert body["is_git_repo"] is False
    assert body["scores"] == []


def test_get_dead_code_flags_the_zero_caller_function():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool("get_dead_code", {"path": str(FIXTURES / "simple_repo")})
        return result.structured_content

    body = _run(scenario())
    candidate_ids = {c["node_id"] for c in body["candidates"]}
    # `Greeter.greet` has no callers anywhere in this fixture -- a real
    # candidate. `format_name` does (`greet` calls it) -- must not appear.
    assert "app.py::Greeter.greet" in candidate_ids
    assert "helpers.py::format_name" not in candidate_ids


def test_get_complexity_diff_reports_unavailable_with_no_earlier_snapshot():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_complexity_diff", {"path": str(FIXTURES / "simple_repo")}
        )
        return result.structured_content

    body = _run(scenario())
    assert body["available"] is False
    node_ids = {score["node_id"] for score in body["current"]}
    assert "app.py::Greeter.greet" in node_ids


def test_get_git_refs_reports_branches_and_commits():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool("get_git_refs", {"path": str(FIXTURES / "simple_repo")})
        return result.structured_content

    body = _run(scenario())
    # Fixture repos live inside this project's own git repo (see
    # test_get_hotspots's own comment on this), so ancestor detection
    # finds it -- this just proves the tool wrapper wires the field names
    # through correctly, not the git-detection logic itself (already
    # covered by test_api.py/test_analysis_git_ops.py).
    assert body["is_git_repo"] is True
    assert isinstance(body["branches"], list)
    assert isinstance(body["commits"], list)


def test_get_flowchart_reports_the_target_functions_entry_block():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_flowchart",
            {"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"},
        )
        return result.structured_content

    body = _run(scenario())
    assert body["target"] == "app.py::Greeter.greet"
    assert body["entry"]
    assert len(body["nodes"]) > 0


def test_get_function_source_returns_the_exact_source_text():
    async def scenario():
        mcp = _server()
        await _parse_simple_repo(mcp)
        result = await mcp.call_tool(
            "get_function_source",
            {"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"},
        )
        return result.structured_content

    body = _run(scenario())
    assert body["id"] == "app.py::Greeter.greet"
    assert "def greet" in body["source"]


def test_extract_detail_prefers_the_detail_field():
    response = httpx.Response(404, json={"detail": "Repository not parsed yet: /x"})
    assert _extract_detail(response) == "Repository not parsed yet: /x"


def test_extract_detail_falls_back_to_text_for_a_non_json_body():
    response = httpx.Response(500, content=b"plain text failure")
    assert _extract_detail(response) == "plain text failure"


def test_extract_detail_falls_back_to_text_for_json_without_a_detail_field():
    response = httpx.Response(400, json={"error": "something else"})
    assert _extract_detail(response) == '{"error":"something else"}'


def test_aclose_terminates_a_spawned_process_that_exits_promptly():
    class FakeProcess:
        def __init__(self):
            self.terminated = False
            self.killed = False

        def terminate(self):
            self.terminated = True

        def wait(self, timeout=None):
            return 0

        def kill(self):
            self.killed = True

    async def scenario():
        client = BackendClient()
        fake = FakeProcess()
        client._process = fake
        await client.aclose()
        return fake

    fake = _run(scenario())
    assert fake.terminated is True
    assert fake.killed is False


def test_aclose_kills_a_spawned_process_that_does_not_terminate_in_time():
    class FakeProcess:
        def __init__(self):
            self.terminated = False
            self.killed = False

        def terminate(self):
            self.terminated = True

        def wait(self, timeout=None):
            raise subprocess.TimeoutExpired(cmd="uvicorn", timeout=timeout or 5)

        def kill(self):
            self.killed = True

    async def scenario():
        client = BackendClient()
        fake = FakeProcess()
        client._process = fake
        await client.aclose()
        return fake

    fake = _run(scenario())
    assert fake.terminated is True
    assert fake.killed is True


def test_spawn_backend_refuses_a_non_loopback_host():
    client = BackendClient(host="0.0.0.0")
    with pytest.raises(BackendError, match="non-loopback"):
        client._spawn_backend()


def test_ensure_running_reuses_an_already_reachable_backend(monkeypatch):
    async def scenario():
        client = BackendClient()
        spawn_calls: list[int] = []

        async def _reachable() -> bool:
            return True

        def _spawn():
            spawn_calls.append(1)
            return None

        monkeypatch.setattr(client, "is_reachable", _reachable)
        monkeypatch.setattr(client, "_spawn_backend", _spawn)
        await client.ensure_running()
        return spawn_calls

    # A reachable backend must never be spawned again on top of.
    assert _run(scenario()) == []


def test_ensure_running_spawns_when_not_reachable(monkeypatch):
    async def scenario():
        client = BackendClient()
        spawn_calls: list[int] = []

        async def _unreachable() -> bool:
            return False

        async def _wait(timeout_s: float = 20.0) -> None:
            return None

        def _spawn():
            spawn_calls.append(1)
            return None

        monkeypatch.setattr(client, "is_reachable", _unreachable)
        monkeypatch.setattr(client, "_spawn_backend", _spawn)
        monkeypatch.setattr(client, "_wait_for_backend", _wait)
        await client.ensure_running()
        return spawn_calls

    assert _run(scenario()) == [1]
