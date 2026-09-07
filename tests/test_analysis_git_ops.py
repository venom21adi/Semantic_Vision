import subprocess
from pathlib import Path

import pytest

import semantic_vision.analysis.git_ops as git_ops
from semantic_vision.analysis.git_ops import (
    GitError,
    checked_out_worktree,
    find_git_root,
    list_refs,
    parse_ref,
)


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _init_repo(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    _git(["init"], root)
    _git(["config", "user.email", "test@example.com"], root)
    _git(["config", "user.name", "Test"], root)


def _commit(root: Path, message: str) -> None:
    _git(["add", "-A"], root)
    _git(["commit", "-m", message], root)


def test_find_git_root_walks_up_to_dot_git(tmp_path: Path):
    _init_repo(tmp_path)
    nested = tmp_path / "src" / "pkg"
    nested.mkdir(parents=True)

    assert find_git_root(nested) == tmp_path.resolve()


def test_find_git_root_returns_none_outside_a_repo(tmp_path: Path):
    outside = tmp_path / "not_a_repo"
    outside.mkdir()

    assert find_git_root(outside) is None


def test_list_refs_returns_branches_and_recent_commits(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("one", encoding="utf-8")
    _commit(tmp_path, "first commit")
    (tmp_path / "a.txt").write_text("two", encoding="utf-8")
    _commit(tmp_path, "second commit")

    branches, commits = list_refs(tmp_path)

    assert len(branches) >= 1
    assert [c.subject for c in commits] == ["second commit", "first commit"]
    assert all(c.sha for c in commits)


def test_list_refs_raises_git_error_on_a_repo_with_no_commits(tmp_path: Path):
    _init_repo(tmp_path)

    with pytest.raises(GitError):
        list_refs(tmp_path)


def test_checked_out_worktree_parses_the_ref_not_the_working_tree(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "app.py").write_text("def committed():\n    return 1\n", encoding="utf-8")
    _commit(tmp_path, "committed version")

    # Dirty the working tree without committing.
    (tmp_path / "app.py").write_text("def uncommitted():\n    return 2\n", encoding="utf-8")

    result = parse_ref(tmp_path, "HEAD")

    names = {node.id for node in result.nodes}
    assert any("committed" in name for name in names)
    assert not any("uncommitted" in name for name in names)


def test_checked_out_worktree_cleans_up_on_exception(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("one", encoding="utf-8")
    _commit(tmp_path, "first commit")

    captured_path = None
    with pytest.raises(RuntimeError):
        with checked_out_worktree(tmp_path, "HEAD") as worktree_path:
            captured_path = worktree_path
            assert worktree_path.is_dir()
            raise RuntimeError("boom")

    assert captured_path is not None
    assert not captured_path.exists()
    listing = subprocess.run(
        ["git", "worktree", "list"], cwd=tmp_path, check=True, capture_output=True, text=True
    ).stdout
    assert str(captured_path) not in listing


def test_parse_ref_raises_git_error_for_unknown_ref(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("one", encoding="utf-8")
    _commit(tmp_path, "first commit")

    with pytest.raises(GitError):
        parse_ref(tmp_path, "does-not-exist-ref")


def test_run_git_raises_git_error_when_git_is_not_installed(tmp_path: Path, monkeypatch):
    def _missing_git(*args, **kwargs):
        raise FileNotFoundError("git not found")

    monkeypatch.setattr(git_ops.subprocess, "run", _missing_git)

    with pytest.raises(GitError, match="not installed"):
        list_refs(tmp_path)
