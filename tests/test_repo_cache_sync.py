import time
from unittest.mock import MagicMock

import pytest

from semantic_vision.api.repo_cache_sync import FAST_CACHE_DIR_ENV, sync_to_fast_cache

PY = frozenset({".py"})


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv(FAST_CACHE_DIR_ENV, raising=False)


def test_returns_none_when_not_configured(tmp_path):
    (tmp_path / "a.py").write_text("x = 1")
    assert sync_to_fast_cache(tmp_path, "python", PY) is None


def test_first_sync_mirrors_matching_files_only(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    (repo / "pkg").mkdir(parents=True)
    (repo / "pkg" / "a.py").write_text("x = 1")
    (repo / "readme.md").write_text("not source")

    tree = sync_to_fast_cache(repo, "python", PY)

    assert tree is not None
    assert (tree / "pkg" / "a.py").read_text() == "x = 1"
    assert not (tree / "readme.md").exists()


def test_unchanged_file_is_not_recopied(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("x = 1")

    sync_to_fast_cache(repo, "python", PY)

    copy_spy = MagicMock(side_effect=__import__("shutil").copy2)
    monkeypatch.setattr("semantic_vision.api.repo_cache_sync.shutil.copy2", copy_spy)

    sync_to_fast_cache(repo, "python", PY)

    copy_spy.assert_not_called()


def test_changed_file_is_recopied(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    source = repo / "a.py"
    source.write_text("x = 1")

    tree = sync_to_fast_cache(repo, "python", PY)
    assert (tree / "a.py").read_text() == "x = 1"

    # Ensure a distinguishable mtime -- some filesystems have coarse
    # mtime resolution, and the fingerprint also checks size, which this
    # edit changes too, so it's a safe rewrite either way.
    time.sleep(0.01)
    source.write_text("x = 2 (longer)")

    tree = sync_to_fast_cache(repo, "python", PY)
    assert (tree / "a.py").read_text() == "x = 2 (longer)"


def test_deleted_source_file_is_removed_from_mirror_and_empty_dir_pruned(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    (repo / "pkg").mkdir(parents=True)
    doomed = repo / "pkg" / "a.py"
    doomed.write_text("x = 1")

    tree = sync_to_fast_cache(repo, "python", PY)
    assert (tree / "pkg" / "a.py").exists()

    doomed.unlink()
    tree = sync_to_fast_cache(repo, "python", PY)

    assert not (tree / "pkg" / "a.py").exists()
    assert not (tree / "pkg").exists()


def test_two_different_roots_get_independent_mirrors(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo_a = tmp_path / "repo_a"
    repo_a.mkdir()
    (repo_a / "a.py").write_text("from repo a")

    repo_b = tmp_path / "repo_b"
    repo_b.mkdir()
    (repo_b / "a.py").write_text("from repo b")

    tree_a = sync_to_fast_cache(repo_a, "python", PY)
    tree_b = sync_to_fast_cache(repo_b, "python", PY)

    assert tree_a != tree_b
    assert (tree_a / "a.py").read_text() == "from repo a"
    assert (tree_b / "a.py").read_text() == "from repo b"


def test_two_languages_on_the_same_root_get_independent_mirrors(tmp_path, monkeypatch):
    """Regression test: a polyglot repo (e.g. a FastAPI backend + a
    Three.js frontend) is parsed once per selected language against the
    *same* root, concurrently (see the frontend's `Promise.all` in
    `App.tsx`'s `handleLoad`). Before `_cache_key` included `language_id`,
    both syncs shared one mirror directory keyed on `root` alone, so the
    JavaScript sync saw every `.py` file as "stale" (absent from its own
    `extensions` filter) and deleted it, and vice versa -- silently
    corrupting whichever language synced second (or, since both run
    concurrently, racing to delete files out from under the other's
    in-flight parse)."""
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "main.py").write_text("x = 1")
    (repo / "app.js").write_text("const x = 1")

    JS = frozenset({".js"})
    py_tree = sync_to_fast_cache(repo, "python", PY)
    js_tree = sync_to_fast_cache(repo, "javascript", JS)

    assert py_tree != js_tree
    assert (py_tree / "main.py").exists()
    assert (js_tree / "app.js").exists()

    # Re-syncing python after javascript synced must not have lost main.py.
    py_tree_again = sync_to_fast_cache(repo, "python", PY)
    assert (py_tree_again / "main.py").exists()


def test_repeat_sync_returns_stable_tree_dir(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("x = 1")

    first = sync_to_fast_cache(repo, "python", PY)
    second = sync_to_fast_cache(repo, "python", PY)

    assert first == second
