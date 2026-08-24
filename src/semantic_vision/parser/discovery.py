"""Recursive discovery of source files in a repository, by extension."""

from __future__ import annotations

import os
from pathlib import Path

EXCLUDED_DIR_NAMES = frozenset(
    {
        "__pycache__",
        "node_modules",
        "site-packages",
        ".visualiser",
    }
)


def discover_files(root: Path, extensions: frozenset[str]) -> list[Path]:
    """Recursively find files under `root` whose name ends with one of
    `extensions` (e.g. `frozenset({".py"})`).

    Hidden directories (leading `.`, e.g. `.git`, `.venv`) and common
    non-source directories are skipped. The result is sorted for
    deterministic output across platforms and filesystem orderings.
    """
    discovered: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames if d not in EXCLUDED_DIR_NAMES and not d.startswith(".")
        ]
        for filename in filenames:
            if filename.endswith(tuple(extensions)):
                discovered.append(Path(dirpath) / filename)
    discovered.sort(key=lambda p: p.relative_to(root).as_posix())
    return discovered
