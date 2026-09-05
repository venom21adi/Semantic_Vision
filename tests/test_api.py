import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import semantic_vision.api.cache as cache_module
import semantic_vision.api.routes as routes_module
from semantic_vision.api.app import app
from semantic_vision.api.cache import cache
from semantic_vision.persistence.store import resolve_doc_root as _real_resolve_doc_root

FIXTURES = Path(__file__).parent / "fixtures"

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _no_git_root_detection(monkeypatch):
    """Fixture repos live inside this project's own git repo, so the real
    ancestor-`.git` auto-detection in `resolve_doc_root` would resolve
    every fixture-based parse to this project's own repo root instead of
    the fixture's own directory -- polluting the real repo's
    `.visualiser/` and colliding across unrelated tests. Default every
    test to the pre-auto-detection behavior (doc_root == the explicit
    override, or the parsed path itself); tests that specifically cover
    detection restore the real function themselves.
    """

    def _identity_resolve(parsed_root: Path, requested: str | None) -> Path:
        return Path(requested).resolve() if requested else parsed_root.resolve()

    monkeypatch.setattr(routes_module.persistence, "resolve_doc_root", _identity_resolve)


def test_parse_repo_success():
    resp = client.post("/api/parse-repo", json={"path": str(FIXTURES / "simple_repo")})

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == 5
    assert body["edge_count"] == 7
    assert body["parse_errors"] == []
    assert body["path"] == (FIXTURES / "simple_repo").resolve().as_posix()


def test_parse_repo_javascript_success():
    resp = client.post(
        "/api/parse-repo",
        json={"path": str(FIXTURES / "js_repo"), "language": "javascript"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == 7
    assert body["edge_count"] == 11
    assert body["parse_errors"] == []
    assert body["path"] == (FIXTURES / "js_repo").resolve().as_posix()


def test_parse_repo_unknown_language_returns_400():
    resp = client.post(
        "/api/parse-repo",
        json={"path": str(FIXTURES / "simple_repo"), "language": "cobol"},
    )

    assert resp.status_code == 400


def test_parse_repo_doc_root_defaults_to_the_parsed_path():
    repo_path = str(FIXTURES / "simple_repo")
    resp = client.post("/api/parse-repo", json={"path": repo_path})

    body = resp.json()
    assert body["doc_root"] == body["path"]


def test_parse_repo_honors_an_explicit_doc_root(tmp_path: Path):
    doc_root = tmp_path / "wherever-i-want"
    doc_root.mkdir()

    resp = client.post(
        "/api/parse-repo",
        json={"path": str(FIXTURES / "simple_repo"), "doc_root": str(doc_root)},
    )

    assert resp.status_code == 200
    assert resp.json()["doc_root"] == doc_root.resolve().as_posix()
    assert (doc_root / ".visualiser" / "metadata.json").is_file()


def test_parse_repo_translates_a_pasted_host_path(monkeypatch):
    """Docker Compose passes `REPO_PATH` through as
    `SEMANTIC_VISION_HOST_REPO_PATH`, so a real host path pasted into the
    app -- not the in-container `/workspace/repo` mount point -- resolves
    correctly. Stands in for the container mount point here with a real
    directory on disk (`FIXTURES`), since these tests don't run inside
    Docker themselves."""
    import semantic_vision.api.host_path as host_path_module

    monkeypatch.setenv(host_path_module.HOST_REPO_PATH_ENV, "C:/fake/host/projects")
    monkeypatch.setattr(host_path_module, "CONTAINER_REPO_ROOT", str(FIXTURES))

    resp = client.post(
        "/api/parse-repo",
        json={"path": "C:/fake/host/projects/simple_repo"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == 5
    assert body["path"] == (FIXTURES / "simple_repo").resolve().as_posix()


def test_parse_repo_uses_fast_cache_when_configured(monkeypatch, tmp_path: Path):
    """When `SEMANTIC_VISION_FAST_CACHE_DIR` is set (as Docker Compose
    sets it -- see docker-compose.yml), parsing mirrors the repo into it
    first and reads from the mirror, but the response's `path` (and thus
    where `.visualiser/` lands) still reflects the real parsed path, not
    the internal cache location."""
    import semantic_vision.api.repo_cache_sync as sync_module

    cache_dir = tmp_path / "fast-cache"
    monkeypatch.setenv(sync_module.FAST_CACHE_DIR_ENV, str(cache_dir))

    resp = client.post("/api/parse-repo", json={"path": str(FIXTURES / "simple_repo")})

    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == 5
    assert body["edge_count"] == 7
    assert body["path"] == (FIXTURES / "simple_repo").resolve().as_posix()

    mirrored = list(cache_dir.rglob("*.py"))
    assert mirrored, "expected the fast cache to contain a mirrored copy of the repo's .py files"


def test_parse_repo_auto_detects_the_nearest_git_root(monkeypatch, tmp_path: Path):
    """Restores the real `resolve_doc_root` (undoing this file's autouse
    identity stub) to verify the actual ancestor-`.git` detection works
    end-to-end through the API, using a throwaway fake project under
    `tmp_path` so it can't collide with this project's own git repo."""
    monkeypatch.setattr(routes_module.persistence, "resolve_doc_root", _real_resolve_doc_root)

    project_root = tmp_path / "project"
    (project_root / ".git").mkdir(parents=True)
    scoped = project_root / "src" / "app"
    scoped.mkdir(parents=True)
    (scoped / "mod.py").write_text("def f():\n    pass\n", encoding="utf-8")

    resp = client.post("/api/parse-repo", json={"path": str(scoped)})

    assert resp.status_code == 200
    assert resp.json()["doc_root"] == project_root.resolve().as_posix()
    assert (project_root / ".visualiser" / "metadata.json").is_file()
    assert not (scoped / ".visualiser").exists()


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

    def counting_parse(path, **kwargs):
        calls.append(path)
        return original(path, **kwargs)

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


def test_health_check():
    resp = client.get("/api/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


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


def test_function_source_file_node_returns_full_file():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/function-source",
        params={"path": repo_path, "id": "app.py"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["file"] == "app.py"
    assert body["line_start"] == 1
    assert body["line_end"] == 8
    assert "import os" in body["source"]
    assert "class Greeter" in body["source"]
    assert "def greet" in body["source"]


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


def test_flowchart_returns_entry_and_return_nodes():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/flowchart",
        params={"path": repo_path, "id": "app.py::Greeter.greet"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["target"] == "app.py::Greeter.greet"
    node_kinds = {n["id"]: n["kind"] for n in body["nodes"]}
    assert node_kinds[body["entry"]] == "entry"
    assert "return" in node_kinds.values()


def test_flowchart_missing_node_returns_404():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/flowchart",
        params={"path": repo_path, "id": "app.py::DoesNotExist"},
    )

    assert resp.status_code == 404


def test_flowchart_non_function_node_returns_404():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get(
        "/api/flowchart",
        params={"path": repo_path, "id": "app.py::Greeter"},
    )

    assert resp.status_code == 404


def test_flowchart_requires_prior_parse():
    resp = client.get(
        "/api/flowchart",
        params={"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"},
    )

    assert resp.status_code == 404


@pytest.fixture
def temp_repo(tmp_path: Path) -> Path:
    """A throwaway repo for persistence tests, so `.visualiser/` writes
    never land inside the checked-in `tests/fixtures/` directories."""
    (tmp_path / "app.py").write_text("def greet():\n    return 1\n", encoding="utf-8")
    return tmp_path


def test_update_doc_root_requires_prior_parse(temp_repo: Path):
    resp = client.put(
        "/api/doc-root", params={"path": str(temp_repo)}, json={"doc_root": str(temp_repo)}
    )

    assert resp.status_code == 404


def test_update_doc_root_moves_future_saves_without_reparsing(temp_repo: Path):
    """Relocating the save path shouldn't force re-parsing the repo --
    parsing a large repo can be slow, which is the whole reason a doc
    root might need to be scoped separately from what's parsed."""
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    new_location = temp_repo / "moved-here"
    new_location.mkdir()

    resp = client.put(
        "/api/doc-root", params={"path": repo_path}, json={"doc_root": str(new_location)}
    )

    assert resp.status_code == 200
    assert resp.json()["doc_root"] == new_location.resolve().as_posix()

    save_resp = client.put(
        "/api/graph-state",
        params={"path": repo_path},
        json={"positions": {"app.py::greet": {"x": 1, "y": 2}}},
    )

    assert save_resp.status_code == 200
    assert (new_location / ".visualiser" / "graph_state.json").is_file()
    assert not (temp_repo / ".visualiser" / "graph_state.json").exists()


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


def test_complexity_requires_prior_parse():
    resp = client.get("/api/complexity", params={"path": str(FIXTURES / "simple_repo")})

    assert resp.status_code == 404


def test_complexity_returns_a_score_per_function_end_to_end():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/complexity", params={"path": repo_path})

    assert resp.status_code == 200
    scores_by_id = {s["node_id"]: s for s in resp.json()["scores"]}
    assert "app.py::Greeter.greet" in scores_by_id
    score = scores_by_id["app.py::Greeter.greet"]
    assert score["cyclomatic_complexity"] >= 1
    assert score["call_chain_depth"] >= 0
    assert isinstance(score["has_nested_loops"], bool)


def test_complexity_is_built_lazily_on_first_request_then_served_from_cache(monkeypatch):
    repo_path = str(FIXTURES / "simple_repo")

    calls = {"count": 0}
    real_build = cache_module.build_complexity_index

    def counting_build(*args, **kwargs):
        calls["count"] += 1
        return real_build(*args, **kwargs)

    monkeypatch.setattr(cache_module, "build_complexity_index", counting_build)

    # Parsing alone must not build the complexity index -- that's the
    # whole point of laziness.
    client.post("/api/parse-repo", json={"path": repo_path})
    assert calls["count"] == 0

    # First GET builds it once...
    client.get("/api/complexity", params={"path": repo_path})
    assert calls["count"] == 1

    # ...and a second GET is served from the cache, not rebuilt.
    client.get("/api/complexity", params={"path": repo_path})
    assert calls["count"] == 1


def test_complexity_index_is_invalidated_by_a_reparse(monkeypatch):
    repo_path = str(FIXTURES / "simple_repo")

    calls = {"count": 0}
    real_build = cache_module.build_complexity_index

    def counting_build(*args, **kwargs):
        calls["count"] += 1
        return real_build(*args, **kwargs)

    monkeypatch.setattr(cache_module, "build_complexity_index", counting_build)

    client.post("/api/parse-repo", json={"path": repo_path})
    client.get("/api/complexity", params={"path": repo_path})
    assert calls["count"] == 1

    # A reparse must drop the previously cached complexity index rather
    # than leaving it in place -- otherwise a stale index (computed from
    # the prior ParseResult) would keep being served forever, since the
    # cache would never see a reason to rebuild it.
    client.post("/api/parse-repo", json={"path": repo_path})
    resp = client.get("/api/complexity", params={"path": repo_path})

    assert resp.status_code == 200
    assert calls["count"] == 2


def test_complexity_index_is_not_resurrected_by_a_reparse_racing_a_build(monkeypatch):
    """Regression test for a real race: `set()`'s invalidation and
    `get_or_build_complexity_index`'s build both touch `_complexity_indexes`
    for the same key. If they aren't ordered by the same lock, a build that
    read the *old* `ParseResult` before a concurrent reparse can finish and
    write its (now-stale) index *after* the reparse's own pop -- resurrecting
    exactly the staleness the pop exists to prevent. This forces that
    interleaving directly (two background threads: one holds the complexity
    lock mid-build, the other attempts a reparse against the same lock) so
    it doesn't depend on hoping a real race reproduces it."""
    import threading
    import time

    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    real_build = cache_module.build_complexity_index
    build_started = threading.Event()
    proceed_with_build = threading.Event()
    calls = {"count": 0}

    def slow_build(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            # Simulate a build that's already read the old ParseResult and
            # is mid-computation (still holding the lock) when a reparse
            # comes in on another thread.
            build_started.set()
            assert proceed_with_build.wait(timeout=5), "never told to proceed"
        return real_build(*args, **kwargs)

    monkeypatch.setattr(cache_module, "build_complexity_index", slow_build)

    builder = threading.Thread(target=lambda: cache.get_or_build_complexity_index(repo_path))
    builder.start()
    assert build_started.wait(timeout=5), "background build never started"

    reparse_response: dict[str, object] = {}
    reparser = threading.Thread(
        target=lambda: reparse_response.update(
            status_code=client.post("/api/parse-repo", json={"path": repo_path}).status_code
        )
    )
    reparser.start()
    # Give the reparser a moment to reach `set()`'s lock acquisition --
    # everything before it (re-parsing the tiny fixture repo, rebuilding
    # the reverse-caller index) is fast, so this margin is generous, not
    # load-bearing precision.
    time.sleep(0.3)

    proceed_with_build.set()
    builder.join(timeout=5)
    reparser.join(timeout=5)
    assert not builder.is_alive()
    assert not reparser.is_alive()
    assert reparse_response.get("status_code") == 200

    # If the reparse's pop ran *before* the lock ordering fixed things, the
    # background build's stale write would land after it and never get
    # cleared -- the next access would be served from cache (count stays 1)
    # instead of rebuilding.
    assert calls["count"] == 1
    cache.get_or_build_complexity_index(repo_path)
    assert calls["count"] == 2


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


def test_impact_on_a_table_node_traverses_into_code_and_orm_classes():
    """End-to-end regression for the bug found while building column-level
    lineage: `build_reverse_caller_index` used to index only `calls`
    edges, so impact analysis on a table node -- despite the feature being
    advertised as spanning code and data in one traversal -- silently
    returned zero callers. `dataflow_repo` has a SQLAlchemy `User` model
    (mapped to `table::users`) and a `service.py::get_user` function that
    reads it via `session.query(User)`; both should show up as upstream of
    the table."""
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.get("/api/impact", params={"path": repo_path, "id": "table::users"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["target"] == "table::users"
    caller_ids = {c["id"] for c in body["callers"]}
    assert "service.py::get_user" in caller_ids
    assert "models.py::User" in caller_ids
    edge_kinds_by_source = {e["source"]: e["kind"] for e in body["edges"]}
    assert edge_kinds_by_source["service.py::get_user"] == "reads"
    assert edge_kinds_by_source["models.py::User"] == "maps_to"


def test_generate_doc_requires_prior_parse():
    resp = client.post(
        "/api/generate-doc",
        params={"path": str(FIXTURES / "simple_repo"), "id": "app.py::Greeter.greet"},
        json={"provider": "ollama"},
    )

    assert resp.status_code == 404


def test_generate_doc_missing_node_returns_404():
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.post(
        "/api/generate-doc",
        params={"path": repo_path, "id": "app.py::DoesNotExist"},
        json={"provider": "ollama"},
    )

    assert resp.status_code == 404


def test_generate_doc_streams_content(monkeypatch):
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    def fake_stream(provider, context, model=None):
        assert provider == "ollama"
        yield "# greet\n\n"
        yield "Documentation."

    monkeypatch.setattr(routes_module, "stream_documentation", fake_stream)

    resp = client.post(
        "/api/generate-doc",
        params={"path": repo_path, "id": "app.py::Greeter.greet"},
        json={"provider": "ollama"},
    )

    assert resp.status_code == 200
    assert resp.text == "# greet\n\nDocumentation."


def test_generate_doc_forwards_the_requested_model(monkeypatch):
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    captured = {}

    def fake_stream(provider, context, model=None):
        captured["model"] = model
        yield "docs"

    monkeypatch.setattr(routes_module, "stream_documentation", fake_stream)

    resp = client.post(
        "/api/generate-doc",
        params={"path": repo_path, "id": "app.py::Greeter.greet"},
        json={"provider": "ollama", "model": "qwen2.5-coder:3b"},
    )

    assert resp.status_code == 200
    assert captured["model"] == "qwen2.5-coder:3b"


def test_generate_doc_streams_content_for_a_file_node(monkeypatch):
    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    captured = {}

    def fake_stream(provider, context, model=None):
        captured["kind"] = context.kind
        yield "# app.py\n\n"
        yield "File documentation."

    monkeypatch.setattr(routes_module, "stream_documentation", fake_stream)

    resp = client.post(
        "/api/generate-doc",
        params={"path": repo_path, "id": "app.py"},
        json={"provider": "ollama"},
    )

    assert resp.status_code == 200
    assert resp.text == "# app.py\n\nFile documentation."
    assert captured["kind"] == "file"


def test_generate_doc_directory_node_returns_404():
    repo_path = str(FIXTURES / "nested_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.post(
        "/api/generate-doc",
        params={"path": repo_path, "id": "pkg"},
        json={"provider": "ollama"},
    )

    assert resp.status_code == 404


def test_generate_doc_provider_failure_returns_502(monkeypatch):
    from semantic_vision.ai.providers import ProviderError

    repo_path = str(FIXTURES / "simple_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    def failing_stream(provider, context, model=None):
        raise ProviderError("boom")

    monkeypatch.setattr(routes_module, "stream_documentation", failing_stream)

    resp = client.post(
        "/api/generate-doc",
        params={"path": repo_path, "id": "app.py::Greeter.greet"},
        json={"provider": "ollama"},
    )

    assert resp.status_code == 502


def test_ollama_models_returns_models_from_the_local_server(monkeypatch):
    monkeypatch.setattr(routes_module, "list_ollama_models", lambda: ["llama3.2:3b", "gemma4:e4b"])

    resp = client.get("/api/ollama-models")

    assert resp.status_code == 200
    assert resp.json() == {"models": ["llama3.2:3b", "gemma4:e4b"]}


def test_ollama_models_returns_empty_list_when_unreachable(monkeypatch):
    monkeypatch.setattr(routes_module, "list_ollama_models", lambda: [])

    resp = client.get("/api/ollama-models")

    assert resp.status_code == 200
    assert resp.json() == {"models": []}


def test_save_doc_round_trips(temp_repo: Path):
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    save_resp = client.post(
        "/api/doc",
        params={"path": repo_path, "id": "app.py::greet"},
        json={"markdown": "# greet\n\nReturns 1."},
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["markdown"] == "# greet\n\nReturns 1."

    get_resp = client.get("/api/doc", params={"path": repo_path, "id": "app.py::greet"})
    assert get_resp.status_code == 200
    assert get_resp.json()["markdown"] == "# greet\n\nReturns 1."


def test_save_doc_missing_node_returns_404(temp_repo: Path):
    repo_path = str(temp_repo)
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.post(
        "/api/doc",
        params={"path": repo_path, "id": "app.py::DoesNotExist"},
        json={"markdown": "# nope"},
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


def test_cors_configured_for_vscode_webview_origin():
    origin = "vscode-webview://1a2b3c4d5e6f"

    resp = client.options(
        "/api/graph",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.headers.get("access-control-allow-origin") == origin


def test_cors_rejects_an_unrelated_origin():
    resp = client.options(
        "/api/graph",
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.headers.get("access-control-allow-origin") is None


def test_dbt_manifest_ingest_requires_prior_parse():
    resp = client.post(
        "/api/dataflow/dbt-manifest",
        params={"path": str(FIXTURES / "dataflow_repo")},
        json={"path": str(FIXTURES / "dbt_manifest.json")},
    )

    assert resp.status_code == 404


def test_dbt_manifest_ingest_reconciles_and_creates_and_merges_into_the_graph():
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.post(
        "/api/dataflow/dbt-manifest",
        params={"path": repo_path},
        json={"path": str(FIXTURES / "dbt_manifest.json")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "models_ingested": 2,
        "tables_reconciled": 1,
        "tables_created": 1,
        "columns_reconciled": 0,
        "columns_created": 2,
    }

    graph_resp = client.get("/api/graph", params={"path": repo_path})
    graph = graph_resp.json()
    node_ids = {n["id"] for n in graph["nodes"]}
    assert "dbt::model.my_project.stg_users" in node_ids
    assert "dbt::model.my_project.fct_orders" in node_ids
    assert "table::fct_orders" in node_ids
    assert "column::fct_orders.id" in node_ids
    assert "column::fct_orders.user_id" in node_ids
    # The pre-existing `table::users` node (from 17a's SQLAlchemy parsing
    # of the fixture repo) is reconciled onto, not duplicated.
    assert sum(1 for n in graph["nodes"] if n["id"] == "table::users") == 1


def test_dbt_manifest_ingest_is_idempotent_on_repeated_ingest():
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})
    manifest_body = {"path": str(FIXTURES / "dbt_manifest.json")}

    client.post("/api/dataflow/dbt-manifest", params={"path": repo_path}, json=manifest_body)
    first_graph = client.get("/api/graph", params={"path": repo_path}).json()

    resp = client.post("/api/dataflow/dbt-manifest", params={"path": repo_path}, json=manifest_body)
    second_graph = client.get("/api/graph", params={"path": repo_path}).json()

    # A second ingest of the identical manifest reconciles onto every
    # `Table` node the first ingest already created -- nothing new there.
    # `Column` nodes tagged `source="dbt"` are a different story: like
    # `MATERIALIZES`/`REFERENCES` edges, they're fully retracted and
    # freshly re-created on every ingest (see `_strip_previous_dbt_ingest`)
    # rather than persisted-and-reconciled the way `Table` nodes are, so
    # they show as "created" again here too -- the graph's own node/edge
    # counts staying flat across the two ingests (below) is what actually
    # proves this doesn't duplicate anything, not the created/reconciled
    # split for this one node kind.
    assert resp.json() == {
        "models_ingested": 2,
        "tables_reconciled": 2,
        "tables_created": 0,
        "columns_reconciled": 0,
        "columns_created": 2,
    }
    assert len(second_graph["nodes"]) == len(first_graph["nodes"])
    assert len(second_graph["edges"]) == len(first_graph["edges"])


def test_dbt_manifest_ingest_retracts_a_stale_materializes_edge_on_re_ingest(tmp_path: Path):
    """Regression: a first implementation merged ingests additively
    forever, so re-ingesting the SAME model after its `alias` changed
    (the realistic workflow -- edit the dbt project, regenerate the
    manifest, re-ingest to refresh lineage) left both the old and the
    new `MATERIALIZES` edge in the graph simultaneously, falsely
    claiming the model still wrote to a table it no longer touches. A
    re-ingest must retract the model's stale edge, not just add the new
    one alongside it."""
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    def _manifest_with_alias(alias: str) -> dict:
        return {
            "nodes": {
                "model.p.x": {
                    "resource_type": "model",
                    "name": "x",
                    "unique_id": "model.p.x",
                    "alias": alias,
                }
            }
        }

    manifest_a = tmp_path / "manifest_a.json"
    manifest_a.write_text(json.dumps(_manifest_with_alias("table_a")), encoding="utf-8")
    manifest_b = tmp_path / "manifest_b.json"
    manifest_b.write_text(json.dumps(_manifest_with_alias("table_b")), encoding="utf-8")

    client.post(
        "/api/dataflow/dbt-manifest", params={"path": repo_path}, json={"path": str(manifest_a)}
    )
    first_edges = client.get("/api/graph", params={"path": repo_path}).json()["edges"]
    assert any(
        e["source"] == "dbt::model.p.x" and e["target"] == "table::table_a"
        for e in first_edges
    )

    client.post(
        "/api/dataflow/dbt-manifest", params={"path": repo_path}, json={"path": str(manifest_b)}
    )
    second_edges = client.get("/api/graph", params={"path": repo_path}).json()["edges"]

    assert any(
        e["source"] == "dbt::model.p.x" and e["target"] == "table::table_b"
        for e in second_edges
    )
    assert not any(
        e["source"] == "dbt::model.p.x" and e["target"] == "table::table_a"
        for e in second_edges
    )
    # Exactly one DBT_MODEL node for `model.p.x`, not a duplicate.
    second_nodes = client.get("/api/graph", params={"path": repo_path}).json()["nodes"]
    assert sum(1 for n in second_nodes if n["id"] == "dbt::model.p.x") == 1


def test_dbt_manifest_ingest_retracts_a_stale_column_on_re_ingest(tmp_path: Path):
    """Same lesson as the stale-`MATERIALIZES`-edge regression above, one
    level down: a column dropped from a model's own `columns` dict
    between manifest regenerations must not linger in the graph forever."""
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    def _manifest_with_columns(column_names: list[str]) -> dict:
        return {
            "nodes": {
                "model.p.x": {
                    "resource_type": "model",
                    "name": "x",
                    "unique_id": "model.p.x",
                    "columns": {name: {"name": name} for name in column_names},
                }
            }
        }

    manifest_a = tmp_path / "manifest_a.json"
    manifest_a.write_text(json.dumps(_manifest_with_columns(["old_col"])), encoding="utf-8")
    manifest_b = tmp_path / "manifest_b.json"
    manifest_b.write_text(json.dumps(_manifest_with_columns(["new_col"])), encoding="utf-8")

    client.post(
        "/api/dataflow/dbt-manifest", params={"path": repo_path}, json={"path": str(manifest_a)}
    )
    first_node_ids = {n["id"] for n in client.get("/api/graph", params={"path": repo_path}).json()["nodes"]}
    assert "column::x.old_col" in first_node_ids

    client.post(
        "/api/dataflow/dbt-manifest", params={"path": repo_path}, json={"path": str(manifest_b)}
    )
    second_node_ids = {n["id"] for n in client.get("/api/graph", params={"path": repo_path}).json()["nodes"]}
    assert "column::x.new_col" in second_node_ids
    assert "column::x.old_col" not in second_node_ids


def test_dbt_manifest_ingest_invalid_path_returns_400():
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.post(
        "/api/dataflow/dbt-manifest",
        params={"path": repo_path},
        json={"path": str(FIXTURES / "does_not_exist_manifest.json")},
    )

    assert resp.status_code == 400


def _sqlite_url(db_path: Path) -> str:
    return f"sqlite:///{db_path.as_posix()}"


def _exec_sql(db_path: Path, *statements: str) -> None:
    import sqlalchemy

    engine = sqlalchemy.create_engine(_sqlite_url(db_path))
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(sqlalchemy.text(stmt))
    engine.dispose()


def test_db_connection_ingest_requires_prior_parse(tmp_path: Path):
    db_path = tmp_path / "app.db"
    _exec_sql(db_path, "CREATE TABLE things (id INTEGER PRIMARY KEY)")

    resp = client.post(
        "/api/dataflow/db-connection",
        params={"path": str(FIXTURES / "dataflow_repo")},
        json={"connection_string": _sqlite_url(db_path)},
    )

    assert resp.status_code == 404


def test_db_connection_ingest_reconciles_and_creates_and_merges_into_the_graph(tmp_path: Path):
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    db_path = tmp_path / "app.db"
    _exec_sql(
        db_path,
        "CREATE TABLE users (id INTEGER PRIMARY KEY)",
        "CREATE TABLE legacy_orders (id INTEGER PRIMARY KEY, user_id INTEGER, "
        "FOREIGN KEY (user_id) REFERENCES users (id))",
    )

    resp = client.post(
        "/api/dataflow/db-connection",
        params={"path": repo_path},
        json={"connection_string": _sqlite_url(db_path)},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "tables_ingested": 2,
        "tables_reconciled": 1,
        "tables_created": 1,
        # `users` has one real column (`id`), reconciling onto the
        # already-existing ORM-declared `column::users.id`; `legacy_orders`
        # is a brand-new table, so both of its columns are newly created.
        "columns_reconciled": 1,
        "columns_created": 2,
    }

    graph = client.get("/api/graph", params={"path": repo_path}).json()
    node_ids = {n["id"] for n in graph["nodes"]}
    assert "table::legacy_orders" in node_ids
    assert "column::legacy_orders.id" in node_ids
    assert "column::legacy_orders.user_id" in node_ids
    # `table::users` was already an ORM-sourced node from 17a -- reconciled
    # onto, not duplicated, and its `source` tag must stay "orm_model".
    users_node = next(n for n in graph["nodes"] if n["id"] == "table::users")
    assert users_node["source"] == "orm_model"
    users_id_column = next(n for n in graph["nodes"] if n["id"] == "column::users.id")
    assert users_id_column["source"] == "orm_model"
    legacy_orders_node = next(n for n in graph["nodes"] if n["id"] == "table::legacy_orders")
    assert legacy_orders_node["source"] == "live_db"


def test_db_connection_ingest_retracts_a_removed_table_and_its_edge_on_re_ingest(
    tmp_path: Path,
):
    """Regression, applying the same lesson learned from the dbt-ingest
    blocker: re-introspecting after the schema changed (a table dropped)
    must retract that table's node and any edge sourced from it, not
    just keep adding to an ever-growing graph."""
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    db_path = tmp_path / "app.db"
    _exec_sql(
        db_path,
        "CREATE TABLE parent (id INTEGER PRIMARY KEY)",
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER, "
        "FOREIGN KEY (parent_id) REFERENCES parent (id))",
    )
    client.post(
        "/api/dataflow/db-connection",
        params={"path": repo_path},
        json={"connection_string": _sqlite_url(db_path)},
    )
    first_graph = client.get("/api/graph", params={"path": repo_path}).json()
    assert "table::child" in {n["id"] for n in first_graph["nodes"]}
    assert any(
        e["source"] == "table::child" and e["target"] == "table::parent"
        for e in first_graph["edges"]
    )

    # Schema change: `child` is dropped entirely.
    _exec_sql(db_path, "DROP TABLE child")

    client.post(
        "/api/dataflow/db-connection",
        params={"path": repo_path},
        json={"connection_string": _sqlite_url(db_path)},
    )
    second_graph = client.get("/api/graph", params={"path": repo_path}).json()

    assert "table::child" not in {n["id"] for n in second_graph["nodes"]}
    assert not any(
        e["source"] == "table::child" or e["target"] == "table::child"
        for e in second_graph["edges"]
    )
    assert "table::parent" in {n["id"] for n in second_graph["nodes"]}


def test_db_connection_ingest_removed_table_does_not_leave_a_dangling_edge_from_an_orm_table(
    tmp_path: Path,
):
    """Regression: a first implementation only retracted a `FOREIGN_KEY`
    edge *sourced from* a removed live-db-tagged table -- it missed an
    edge merely *targeting* one. Here `orders` is an `orm_model`-tagged
    table (from 17a's SQLAlchemy parsing of the fixture repo) with a
    live-DB-only FK to `shipments`, a table that exists only via this
    ingest. Dropping `shipments` from the live schema and re-ingesting
    must retract that edge too, even though its source (`orders`) is
    untouched -- otherwise it dangles at a node that no longer exists."""
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    db_path = tmp_path / "app.db"
    _exec_sql(
        db_path,
        "CREATE TABLE shipments (id INTEGER PRIMARY KEY)",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, shipment_id INTEGER, "
        "FOREIGN KEY (shipment_id) REFERENCES shipments (id))",
    )
    client.post(
        "/api/dataflow/db-connection",
        params={"path": repo_path},
        json={"connection_string": _sqlite_url(db_path)},
    )
    first_graph = client.get("/api/graph", params={"path": repo_path}).json()
    assert any(
        e["source"] == "table::orders" and e["target"] == "table::shipments"
        for e in first_graph["edges"]
    )
    orders_node = next(n for n in first_graph["nodes"] if n["id"] == "table::orders")
    assert orders_node["source"] == "orm_model"

    # Schema change: `shipments` is dropped, and `orders` no longer FKs to it.
    _exec_sql(
        db_path,
        "DROP TABLE orders",
        "DROP TABLE shipments",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY)",
    )

    client.post(
        "/api/dataflow/db-connection",
        params={"path": repo_path},
        json={"connection_string": _sqlite_url(db_path)},
    )
    second_graph = client.get("/api/graph", params={"path": repo_path}).json()

    assert "table::shipments" not in {n["id"] for n in second_graph["nodes"]}
    assert not any(e["target"] == "table::shipments" for e in second_graph["edges"])
    # 17a's own edges for `orders` (its ORM-declared FK to `users`) must
    # survive untouched -- this retraction must not have collateral damage.
    assert any(
        e["source"] == "table::orders" and e["target"] == "table::users"
        for e in second_graph["edges"]
    )


def test_db_connection_ingest_invalid_connection_string_returns_400():
    repo_path = str(FIXTURES / "dataflow_repo")
    client.post("/api/parse-repo", json={"path": repo_path})

    resp = client.post(
        "/api/dataflow/db-connection",
        params={"path": repo_path},
        json={"connection_string": "not-a-valid-url"},
    )

    assert resp.status_code == 400
