"""Mirrors a repo into fast, container-local storage before parsing, so a
repeat parse of the same repo doesn't re-pay the cost of reading it.

Only matters in Docker on Windows/macOS: `docker-compose.yml` bind-mounts
`REPO_PATH` across the Docker Desktop host<->VM boundary, and *every* file
read across that boundary carries a fixed per-syscall latency tax -- for a
few hundred small source files, that tax dominates parse time far more than
actual parsing does (profiled: ~1100 files cost ~16s in open/read/close
alone, on top of ~5s just walking the tree). None of that tax applies to a
container-local path, because it never crosses the boundary.

So rather than parsing directly from the bind mount every time, this syncs
it into a plain directory inside a Docker-managed named volume first --
copying only files that are new or changed since the last sync (tracked in
a small on-disk manifest), then parsing proceeds against that local copy.
The first sync of a never-before-seen repo still pays the full read cost
once (nothing can avoid that -- the bytes have to cross the boundary at
least one time). Every sync after that, for the same repo, only re-copies
whatever actually changed -- typically nothing, making it fast.

This is purely an internal performance cache: the named volume is not
host-mounted, not writable from outside the container, and grants no new
filesystem access beyond what `REPO_PATH` already exposes read-only. It
does not change what the app can see or do, only how fast a repeat parse
of the same repo is.

`docker-compose.yml` sets `SEMANTIC_VISION_FAST_CACHE_DIR` to point at the
named volume's mount point. Outside Docker that variable is unset, so
`sync_to_fast_cache` always returns `None` and callers fall back to
reading the real path directly -- unchanged from before this existed.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

FAST_CACHE_DIR_ENV = "SEMANTIC_VISION_FAST_CACHE_DIR"

_MANIFEST_NAME = "manifest.json"
_TREE_DIRNAME = "tree"


def _cache_key(root: Path) -> str:
    return hashlib.sha256(root.as_posix().encode("utf-8")).hexdigest()[:24]


def _load_manifest(manifest_path: Path) -> dict[str, list[int]]:
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write_manifest(manifest_path: Path, manifest: dict[str, list[int]]) -> None:
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def _walk_with_stats(root: Path, extensions: frozenset[str]) -> dict[str, tuple[Path, int, int]]:
    """Combined discovery + stat in one pass: for every matching file
    under `root`, one `os.scandir` call gets both its name and (via
    `DirEntry.stat()`) its size/mtime from the same directory read,
    instead of a separate `Path.stat()` call per file afterward. On a
    bind-mounted path in Docker, each of those would otherwise be its own
    round trip across the Docker Desktop VM boundary -- for a repo with
    ~1000 files, that's ~1000 avoidable round trips, found by direct
    measurement to cost about as much as the change-detection walk itself
    was supposed to save by skipping unchanged files' *contents*.

    Mirrors `parser/discovery.py`'s exclusion rules (hidden dirs,
    `EXCLUDED_DIR_NAMES`) so this sees exactly the same file set
    `discover_files` would."""
    from semantic_vision.parser.discovery import EXCLUDED_DIR_NAMES

    found: dict[str, tuple[Path, int, int]] = {}

    def _walk(dir_path: Path) -> None:
        with os.scandir(dir_path) as entries:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    if entry.name in EXCLUDED_DIR_NAMES or entry.name.startswith("."):
                        continue
                    _walk(Path(entry.path))
                elif entry.name.endswith(tuple(extensions)):
                    stat = entry.stat()
                    rel_path = Path(entry.path).relative_to(root).as_posix()
                    found[rel_path] = (Path(entry.path), stat.st_size, stat.st_mtime_ns)

    _walk(root)
    return found


def sync_to_fast_cache(root: Path, extensions: frozenset[str]) -> Path | None:
    """Mirrors every file under `root` matching `extensions` into fast
    local storage, copying only what's new or changed since the last call
    for this same `root`. Returns the mirror directory to parse from, or
    `None` if no fast-cache directory is configured (e.g. outside Docker),
    in which case the caller should read `root` directly as before."""
    cache_dir = os.environ.get(FAST_CACHE_DIR_ENV, "")
    if not cache_dir:
        return None

    repo_cache_dir = Path(cache_dir) / _cache_key(root)
    tree_dir = repo_cache_dir / _TREE_DIRNAME
    manifest_path = repo_cache_dir / _MANIFEST_NAME
    tree_dir.mkdir(parents=True, exist_ok=True)

    previous_manifest = _load_manifest(manifest_path)
    current_files = _walk_with_stats(root, extensions)

    new_manifest: dict[str, list[int]] = {}
    for rel_path, (path, size, mtime_ns) in current_files.items():
        fingerprint = [size, mtime_ns]
        new_manifest[rel_path] = fingerprint

        if previous_manifest.get(rel_path) == fingerprint:
            continue

        dest = tree_dir / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)

    stale_rel_paths = set(previous_manifest) - set(current_files)
    for rel_path in stale_rel_paths:
        stale_file = tree_dir / rel_path
        stale_file.unlink(missing_ok=True)

    _prune_empty_dirs(tree_dir)
    _write_manifest(manifest_path, new_manifest)
    return tree_dir


def _prune_empty_dirs(tree_dir: Path) -> None:
    """Removes now-empty directories left behind by files deleted from the
    source repo since the last sync -- otherwise they'd linger forever in
    the mirror, harmlessly but pointlessly."""
    for dirpath, dirnames, filenames in os.walk(tree_dir, topdown=False):
        if dirpath == str(tree_dir):
            continue
        if not dirnames and not filenames:
            Path(dirpath).rmdir()
