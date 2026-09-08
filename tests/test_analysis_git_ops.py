import os
import subprocess
from pathlib import Path

import pytest

import semantic_vision.analysis.git_ops as git_ops
from semantic_vision.analysis.git_ops import (
    GitError,
    checked_out_worktree,
    compute_file_churn,
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


def _commit_dated(root: Path, message: str, iso_date: str) -> None:
    """Commits with an explicit author/committer date, for testing
    `compute_file_churn`'s `--since` window filtering deterministically."""
    _git(["add", "-A"], root)
    env = {**os.environ, "GIT_AUTHOR_DATE": iso_date, "GIT_COMMITTER_DATE": iso_date}
    subprocess.run(
        ["git", "commit", "-m", message],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )


def test_compute_file_churn_counts_commits_touching_each_file(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "a.py").write_text("a1", encoding="utf-8")
    _commit(tmp_path, "touch a")
    (tmp_path / "a.py").write_text("a2", encoding="utf-8")
    (tmp_path / "b.py").write_text("b1", encoding="utf-8")
    _commit(tmp_path, "touch a and b")
    (tmp_path / "b.py").write_text("b2", encoding="utf-8")
    _commit(tmp_path, "touch b")
    (tmp_path / "c.py").write_text("c1", encoding="utf-8")
    _commit(tmp_path, "touch c")

    churn = compute_file_churn(tmp_path, window_days=3650)

    assert churn == {"a.py": 2, "b.py": 2, "c.py": 1}


def test_compute_file_churn_excludes_merge_commits(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "a.py").write_text("line1\n", encoding="utf-8")
    _commit(tmp_path, "initial")
    main_branch = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    _git(["checkout", "-b", "feature"], tmp_path)
    (tmp_path / "a.py").write_text("line1\nline2\n", encoding="utf-8")
    _commit(tmp_path, "feature change")

    _git(["checkout", main_branch], tmp_path)
    (tmp_path / "a.py").write_text("line1\nline3\n", encoding="utf-8")
    _commit(tmp_path, "master change")

    merge = subprocess.run(
        ["git", "merge", "feature", "--no-ff", "-m", "merge feature"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert merge.returncode != 0  # expect a real conflict to resolve
    (tmp_path / "a.py").write_text("line1\nline2\nline3\nmerge-only-change\n", encoding="utf-8")
    _commit(tmp_path, "merge feature")

    churn = compute_file_churn(tmp_path, window_days=3650)

    # 3 regular commits touched a.py; the merge commit's own conflict
    # resolution (which introduces content -- "merge-only-change" -- not
    # present in either parent) must not add a 4th.
    assert churn == {"a.py": 3}


def test_compute_file_churn_excludes_commits_outside_the_window(tmp_path: Path):
    _init_repo(tmp_path)
    (tmp_path / "old.py").write_text("old", encoding="utf-8")
    _commit_dated(tmp_path, "old commit", "2000-01-01T00:00:00")
    (tmp_path / "new.py").write_text("new", encoding="utf-8")
    _commit(tmp_path, "recent commit")

    churn = compute_file_churn(tmp_path, window_days=90)

    assert churn == {"new.py": 1}


def test_compute_file_churn_attributes_a_root_level_rename_to_the_new_name(tmp_path: Path):
    # `git log --numstat` reports a rename with no shared directory prefix
    # as a plain `old => new` pair on one line, not two tab-separated
    # paths -- a naive `\t`-split would treat that whole string as a
    # single garbled "path", losing the commit for both names.
    _init_repo(tmp_path)
    (tmp_path / "old.py").write_text("line1\nline2\nline3\nline4\nline5\n", encoding="utf-8")
    _commit(tmp_path, "add old.py")
    _git(["mv", "old.py", "new.py"], tmp_path)
    _commit(tmp_path, "rename old.py to new.py")

    churn = compute_file_churn(tmp_path, window_days=3650)

    assert churn == {"old.py": 1, "new.py": 1}


def test_compute_file_churn_attributes_a_same_directory_rename_to_the_new_name(tmp_path: Path):
    # A rename that shares a directory prefix/suffix is condensed to
    # `prefix{old => new}suffix` instead -- a different, also-easy-to-
    # mis-parse notation from the plain-pair case above.
    _init_repo(tmp_path)
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "old.py").write_text(
        "lineA\nlineB\nlineC\nlineD\nlineE\n", encoding="utf-8"
    )
    _commit(tmp_path, "add sub/old.py")
    _git(["mv", "sub/old.py", "sub/new.py"], tmp_path)
    _commit(tmp_path, "rename sub/old.py to sub/new.py")

    churn = compute_file_churn(tmp_path, window_days=3650)

    assert churn == {"sub/old.py": 1, "sub/new.py": 1}


def test_compute_file_churn_returns_empty_dict_for_a_repo_with_no_commits(tmp_path: Path):
    _init_repo(tmp_path)

    assert compute_file_churn(tmp_path) == {}


def test_compute_file_churn_returns_empty_dict_when_git_is_not_installed(
    tmp_path: Path, monkeypatch
):
    def _missing_git(*args, **kwargs):
        raise FileNotFoundError("git not found")

    monkeypatch.setattr(git_ops.subprocess, "run", _missing_git)

    assert compute_file_churn(tmp_path) == {}
