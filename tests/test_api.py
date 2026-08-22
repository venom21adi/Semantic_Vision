from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import semantic_vision.api.routes as routes_module
from semantic_vision.api.app import app
from semantic_vision.api.cache import cache

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
    import semantic_vision.repo_parser as repo_parser_module

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


@pytest.fixture
def temp_repo(tmp_path: Path) -> Path:
    """A throwaway repo for persistence tests, so `.visualiser/` writes
    never land inside the checked-in `tests/fixtures/` directories."""
    (tmp_path / "app.py").write_text("def greet():\n    return 1\n", encoding="utf-8")
    return tmp_path


def test_graph_state_defaults_to_empty_before_any_save(temp_repo: Path):
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/graph-state", params={"path": repo_path})

    assert resp.status_code == 200
    assert resp.json() == {"positions": {}, "updated_at": None}


def test_graph_state_requires_prior_parse(temp_repo: Path):
    resp = client.get("/api/graph-state", params={"path": str(temp_repo)})

    assert resp.status_code == 404


def test_graph_state_save_and_reload_round_trips(temp_repo: Path):
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    positions = {"app.py::greet": {"x": 12.5, "y": -4.0}}
    save_resp = client.put(
        "/api/graph-state", params={"path": repo_path}, json={"positions": positions}
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["positions"] == positions
    assert save_resp.json()["updated_at"] is not None

    get_resp = client.get("/api/graph-state", params={"path": repo_path})
    assert get_resp.status_code == 200
    assert get_resp.json()["positions"] == positions


def test_graph_state_save_of_a_subset_preserves_other_saved_positions(temp_repo: Path):
    """A client that only has a scoped subset of nodes rendered (e.g. the
    frontend's File view) must not wipe out other nodes' saved positions
    when it saves."""
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    client.put(
        "/api/graph-state",
        params={"path": repo_path},
        json={"positions": {"app.py::greet": {"x": 1, "y": 1}, "other::node": {"x": 2, "y": 2}}},
    )

    save_resp = client.put(
        "/api/graph-state",
        params={"path": repo_path},
        json={"positions": {"app.py::greet": {"x": 9, "y": 9}}},
    )

    assert save_resp.status_code == 200
    assert save_resp.json()["positions"] == {
        "app.py::greet": {"x": 9, "y": 9},
        "other::node": {"x": 2, "y": 2},
    }


def test_docs_index_empty_before_any_doc_saved(temp_repo: Path):
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/docs", params={"path": repo_path})

    assert resp.status_code == 200
    assert resp.json() == {"entries": []}


def test_doc_returns_404_when_not_saved(temp_repo: Path):
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/doc", params={"path": repo_path, "id": "app.py::greet"})

    assert resp.status_code == 404


def test_doc_returns_saved_markdown(temp_repo: Path):
    from semantic_vision.persistence import store as persistence

    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})
    persistence.write_doc(temp_repo, "app.py::greet", "# greet\n\nReturns 1.")

    resp = client.get("/api/doc", params={"path": repo_path, "id": "app.py::greet"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_id"] == "app.py::greet"
    assert body["markdown"] == "# greet\n\nReturns 1."


def test_impact_requires_prior_parse():
    resp = client.get(
        "/api/impact", params={"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"}
    )

    assert resp.status_code == 404


def test_impact_missing_node_returns_404():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/impact", params={"path": repo_path, "id": "app.py::DoesNotExist"})

    assert resp.status_code == 404


def test_impact_with_no_callers_returns_empty_result():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/impact", params={"path": repo_path, "id": "app.py::Greeter.greet"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["target"] == "app.py::Greeter.greet"
    assert body["callers"] == []
    assert body["edges"] == []
    assert body["cycles"] == []


def test_impact_reports_a_circular_call_chain_end_to_end():
    repo_path = str(FIXTURES / "circular_calls_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/impact", params={"path": repo_path, "id": "a.py::func_a"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["target"] == "a.py::func_a"
    callers_by_id = {c["id"]: c for c in body["callers"]}
    assert callers_by_id["c.py::func_c"] == {"id": "c.py::func_c", "depth": 1, "direct": True}
    assert callers_by_id["b.py::func_b"] == {"id": "b.py::func_b", "depth": 2, "direct": False}
    assert body["cycles"] == [["a.py::func_a", "b.py::func_b"]]


def test_impact_max_depth_limits_transitive_callers():
    repo_path = str(FIXTURES / "circular_calls_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/impact",
        params={"path": repo_path, "id": "a.py::func_a", "max_depth": 1},
    )

    assert resp.status_code == 200
    assert {c["id"] for c in resp.json()["callers"]} == {"c.py::func_c"}


def test_cors_configured_for_vite_dev_server():
    resp = client.options(
        "/api/graph",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
