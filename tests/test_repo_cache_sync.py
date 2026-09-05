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
    assert sync_to_fast_cache(tmp_path, PY) is None


def test_first_sync_mirrors_matching_files_only(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    (repo / "pkg").mkdir(parents=True)
    (repo / "pkg" / "a.py").write_text("x = 1")
    (repo / "readme.md").write_text("not source")

    tree = sync_to_fast_cache(repo, PY)

    assert tree is not None
    assert (tree / "pkg" / "a.py").read_text() == "x = 1"
    assert not (tree / "readme.md").exists()


def test_unchanged_file_is_not_recopied(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("x = 1")

    sync_to_fast_cache(repo, PY)

    copy_spy = MagicMock(side_effect=__import__("shutil").copy2)
    monkeypatch.setattr("semantic_vision.api.repo_cache_sync.shutil.copy2", copy_spy)

    sync_to_fast_cache(repo, PY)

    copy_spy.assert_not_called()


def test_changed_file_is_recopied(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    source = repo / "a.py"
    source.write_text("x = 1")

    tree = sync_to_fast_cache(repo, PY)
    assert (tree / "a.py").read_text() == "x = 1"

    # Ensure a distinguishable mtime -- some filesystems have coarse
    # mtime resolution, and the fingerprint also checks size, which this
    # edit changes too, so it's a safe rewrite either way.
    time.sleep(0.01)
    source.write_text("x = 2 (longer)")

    tree = sync_to_fast_cache(repo, PY)
    assert (tree / "a.py").read_text() == "x = 2 (longer)"


def test_deleted_source_file_is_removed_from_mirror_and_empty_dir_pruned(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    (repo / "pkg").mkdir(parents=True)
    doomed = repo / "pkg" / "a.py"
    doomed.write_text("x = 1")

    tree = sync_to_fast_cache(repo, PY)
    assert (tree / "pkg" / "a.py").exists()

    doomed.unlink()
    tree = sync_to_fast_cache(repo, PY)

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

    tree_a = sync_to_fast_cache(repo_a, PY)
    tree_b = sync_to_fast_cache(repo_b, PY)

    assert tree_a != tree_b
    assert (tree_a / "a.py").read_text() == "from repo a"
    assert (tree_b / "a.py").read_text() == "from repo b"


def test_repeat_sync_returns_stable_tree_dir(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setenv(FAST_CACHE_DIR_ENV, str(cache_dir))

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("x = 1")

    first = sync_to_fast_cache(repo, PY)
    second = sync_to_fast_cache(repo, PY)

    assert first == second
