from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import acv_ad.api.routes as routes_module
from acv_ad.api.app import app
from acv_ad.api.cache import cache

FIXTURES = Path(__file__).parent / "fixtures"

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def test_parse_repo_success():
    resp = client.post("/api/parse-repo", json={"path": str(FIXTURES / "simple_repo")})

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == 5
    assert body["edge_count"] == 7
    assert body["parse_errors"] == []
    assert body["path"] == (FIXTURES / "simple_repo").resolve().as_posix()


def test_parse_repo_invalid_path_returns_400():
    resp = client.post("/api/parse-repo", json={"path": str(FIXTURES / "does_not_exist")})

    assert resp.status_code == 400


def test_parse_repo_unreadable_path_returns_400(monkeypatch):
    """Exercises the `os.access` readability check specifically (as
    opposed to the "doesn't exist" case above) -- Windows ACLs don't
    reliably honor POSIX-style chmod, so `os.access` is monkeypatched
    rather than relying on a real unreadable directory being portable."""
    import acv_ad.repo_parser as repo_parser_module

    original_access = repo_parser_module.os.access
    target = (FIXTURES / "simple_repo").resolve()

    def denied(path, mode):
        if Path(path).resolve() == target:
            return False
        return original_access(path, mode)

    monkeypatch.setattr(repo_parser_module.os, "access", denied)

    resp = client.post("/api/parse-repo", json={"path": str(FIXTURES / "simple_repo")})

    assert resp.status_code == 400


def test_graph_requires_prior_parse():
    resp = client.get("/api/graph", params={"path": str(FIXTURES / "simple_repo")})

    assert resp.status_code == 404


def test_graph_is_served_from_cache_after_parse(monkeypatch):
    calls: list[str] = []
    original = routes_module.parse_repository

    def counting_parse(path):
        calls.append(path)
        return original(path)

    monkeypatch.setattr(routes_module, "parse_repository", counting_parse)

    repo_path = str(FIXTURES / "simple_repo")
    parse_resp = client.post("/api/parse-repo", json={"path": repo_path})
    assert parse_resp.status_code == 200

    graph_resp = client.get("/api/graph", params={"path": repo_path})
    assert graph_resp.status_code == 200
    body = graph_resp.json()
    assert len(body["nodes"]) == 5
    assert len(body["edges"]) == 7
    assert {n["id"] for n in body["nodes"]} >= {"app.py::Greeter.greet", "helpers.py::format_name"}
    assert {e["kind"] for e in body["edges"]} == {"defines", "imports", "calls"}

    # Only the POST should have triggered an actual parse; GET must be
    # served from the cache, not re-walk/re-parse the repo.
    assert calls == [repo_path]


def test_function_source_returns_snippet():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/function-source",
        params={"path": repo_path, "id": "app.py::Greeter.greet"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["file"] == "app.py"
    assert body["line_start"] == 6
    assert body["line_end"] == 8
    assert "def greet" in body["source"]
    assert "os.path.join" in body["source"]


def test_function_source_missing_node_returns_404():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/function-source",
        params={"path": repo_path, "id": "app.py::DoesNotExist"},
    )

    assert resp.status_code == 404


def test_function_source_non_function_node_returns_404():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/function-source",
        params={"path": repo_path, "id": "app.py::Greeter"},
    )

    assert resp.status_code == 404


def test_function_source_requires_prior_parse():
    resp = client.get(
        "/api/function-source",
        params={"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"},
    )

    assert resp.status_code == 404


def test_cors_configured_for_vite_dev_server():
    resp = client.options(
        "/api/graph",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
