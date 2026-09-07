"""Git plumbing for the ref-diff dashboard feature: finding a repo's git
root, listing refs for a picker, and running the parse pipeline against an
arbitrary ref via a temporary worktree.

`subprocess` + the `git` CLI, deliberately -- no new dependency
(no GitPython/pygit2), consistent with this project having no git plumbing
anywhere else.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from semantic_vision.analysis.complexity import (
    DEFAULT_MAX_CALL_CHAIN_DEPTH,
    ComplexityScore,
    build_complexity_index,
)
from semantic_vision.languages.base import LanguageAdapter
from semantic_vision.models import ParseResult
from semantic_vision.repo_parser import parse_repository

# Field delimiter for `git log --format`: a commit subject can contain a
# plain space or comma, but never this control character.
_FIELD_SEP = "\x1f"


class GitError(Exception):
    """Raised for any git operation this module can't recover from itself
    -- not a git repo, unknown ref, git not installed, a worktree
    operation failing. Routes translate this to a 400, never a raw
    subprocess/500."""


# Serializes concurrent `git worktree add`/`remove` against git repos --
# concurrent worktree operations on one repo can conflict (git's own
# index/lock file). One process-wide lock, not per-repo: this is an
# explicit, infrequent user action (a "Compare to commit" click), not a
# hot path, so correctness beats throughput here -- same tradeoff
# `RepoCache._complexity_lock` already makes.
_worktree_lock = threading.Lock()


def _run_git(args: list[str], *, cwd: Path) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise GitError("git is not installed or not on PATH") from exc

    if result.returncode != 0:
        raise GitError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def find_git_root(path: str | Path) -> Path | None:
    """Walks up from `path` looking for a `.git` entry, mirroring
    `persistence.store.resolve_doc_root`'s ancestor walk. Returns `None`
    if no ancestor has one (path is outside any git repo, or doesn't
    exist)."""
    current = Path(path).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


@dataclass(frozen=True)
class GitBranch:
    name: str


@dataclass(frozen=True)
class GitCommit:
    sha: str
    subject: str


def list_refs(git_root: Path, *, max_commits: int = 30) -> tuple[list[GitBranch], list[GitCommit]]:
    """Local branches (`git branch`) and the most recent commits on HEAD
    (`git log`), for a compare-to-ref picker. Raises `GitError` if either
    call fails -- e.g. a brand-new repo with zero commits yet, where
    `git log` exits non-zero."""
    branch_output = _run_git(["branch", "--format=%(refname:short)"], cwd=git_root)
    branches = [GitBranch(name=line) for line in branch_output.splitlines() if line.strip()]

    log_output = _run_git(
        ["log", f"--format=%h{_FIELD_SEP}%s", f"-n{max_commits}"], cwd=git_root
    )
    commits = []
    for line in log_output.splitlines():
        if not line.strip():
            continue
        sha, _, subject = line.partition(_FIELD_SEP)
        commits.append(GitCommit(sha=sha, subject=subject))

    return branches, commits


@contextmanager
def checked_out_worktree(git_root: Path, ref: str) -> Iterator[Path]:
    """Creates a temporary worktree at `ref`, yields its path, and
    guarantees the worktree is removed again even on exception.

    A bad/unknown `ref` makes `git worktree add` exit non-zero, raised as
    `GitError` *before* yielding -- callers never see a half-created
    worktree. Serialized on `_worktree_lock` for the whole add-through-
    remove span, since concurrent `git worktree add` calls against the
    same repo can race on git's own housekeeping.
    """
    with _worktree_lock:
        tmp_dir = Path(tempfile.mkdtemp(prefix="sv-worktree-"))
        try:
            _run_git(["worktree", "add", "--detach", str(tmp_dir), ref], cwd=git_root)
        except GitError:
            # `git worktree add` failed before creating anything git-tracked --
            # only the empty tempdir needs cleaning up.
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise

        try:
            yield tmp_dir
        finally:
            try:
                _run_git(["worktree", "remove", "--force", str(tmp_dir)], cwd=git_root)
            except GitError:
                pass
            # `git worktree remove` normally deletes the directory itself;
            # best-effort cleanup of any leftovers (e.g. a Windows
            # sharing-violation window), not a correctness issue if it fails.
            shutil.rmtree(tmp_dir, ignore_errors=True)


def parse_ref(
    git_root: Path, ref: str, *, language: str | LanguageAdapter = "python"
) -> ParseResult:
    """Checks out `ref` into a scratch worktree and parses it, reading
    bytes from the worktree but reporting `ParseResult.root` as `git_root`
    -- required for node ids (which are relative to the *read* path, not
    `root`) to line up 1:1 with the current-state complexity index.

    CAUTION: the worktree backing this `ParseResult` is removed the moment
    this function returns (`checked_out_worktree`'s cleanup runs on the
    `with` block's exit, which happens *before* control returns to the
    caller). Anything that re-reads source files from `ParseResult.root`
    afterwards -- which `complexity.build_complexity_index` does, via
    `ast_locate`/`ts_locate`/`java_locate` -- will silently read whatever
    now lives on disk at `git_root` (the real, current working tree)
    instead of `ref`'s content. Only consume this `ParseResult` for data
    already captured in-memory during parsing (`nodes`, `edges`,
    `variables`, `parse_errors`); for anything that needs a second disk
    read against `ref`'s content specifically, use
    `build_ref_complexity_index` instead, which does that work inside the
    worktree's lifetime.

    Deliberately never touches `RepoCache`/`persistence.resolve_doc_root`
    -- this is a scratch parse for a one-off diff, not a real "current"
    parse -- and never goes through `sync_to_fast_cache` (that's a
    Docker path-hash cache; a fresh temp worktree directory is a new path
    on every call, so it would never hit, and would only add overhead).
    """
    with checked_out_worktree(git_root, ref) as worktree_path:
        return parse_repository(git_root, language=language, read_root=worktree_path)


def build_ref_complexity_index(
    git_root: Path,
    ref: str,
    path: str | Path,
    *,
    language: str | LanguageAdapter = "python",
    max_call_chain_depth: int = DEFAULT_MAX_CALL_CHAIN_DEPTH,
) -> dict[str, ComplexityScore]:
    """Checks out `ref` into a scratch worktree, parses the same subtree
    the current on-disk parse covers, and computes its complexity index --
    all while the worktree still exists.

    This has to be one function rather than `parse_ref` followed by a
    separate `build_complexity_index` call: complexity scoring re-reads
    each function's source a second time from disk (see
    `complexity.build_complexity_index`'s use of `ast_locate`/`ts_locate`/
    `java_locate`), and by the time `parse_ref` returns, the worktree it
    parsed is already gone (`checked_out_worktree` tears it down on the
    `with` block's exit, before the caller regains control) -- a caller
    building the index afterwards would either get a location-lookup
    failure or, worse, silently succeed by reading `git_root`'s *current*
    working-tree content instead of `ref`'s.

    `path` is the same path the current on-disk parse used -- the repo
    root itself, or any subdirectory of it (whatever was passed to
    `POST /api/parse-repo`) -- so node ids come out relative to `path`
    (e.g. `app.py::f`, not `sub/app.py::f` if `path` is `<git_root>/sub`),
    matching how the current-state complexity index is keyed. Raises
    `GitError` if `path` isn't actually inside `git_root` (shouldn't
    happen given callers derive `git_root` from `path` via
    `find_git_root`, but checked rather than trusted).
    """
    git_root = Path(git_root).resolve()
    analyzed_root = Path(path).resolve()
    try:
        offset = analyzed_root.relative_to(git_root)
    except ValueError as exc:
        raise GitError(f"{analyzed_root} is not inside the git repository at {git_root}") from exc

    with checked_out_worktree(git_root, ref) as worktree_path:
        worktree_subdir = worktree_path / offset
        if not worktree_subdir.is_dir():
            raise GitError(
                f"{offset.as_posix() or '.'} does not exist at ref {ref!r} "
                f"(it may not have existed yet, or have since been renamed/moved)"
            )
        result = parse_repository(worktree_subdir, language=language)
        return build_complexity_index(result, max_call_chain_depth=max_call_chain_depth)
