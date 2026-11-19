"""Project structure of a C# repository: which `.csproj` owns a file, and which
other projects it can see.

A C# compiler only resolves a type name against the types of the project being
built and the projects it references, never against the rest of the repository.
Real repositories contain many same-named types in different projects (a
`Program` per sample, test doubles, fixtures that redeclare a framework type),
so resolving a name against *all* of them either ties or picks wrong. Knowing
which projects can see which restores the compiler's own scoping.

Only what resolution needs is read: each project's directory and its
`ProjectReference` items. Files are matched to the nearest enclosing project
directory, which is exactly SDK-style projects' default (everything under the
directory, except what a nested project owns).
"""

from __future__ import annotations

import os
import posixpath
import re
from pathlib import Path

_PROJECT_REFERENCE = re.compile(r"<ProjectReference\s[^>]*?\bInclude\s*=\s*\"([^\"]+)\"", re.I)
_SKIP_DIRS = frozenset({"bin", "obj", "node_modules", "packages"})
_MAX_PROJECT_FILE_BYTES = 2_000_000


class ProjectMap:
    def __init__(self, refs: dict[str, tuple[str, ...]]) -> None:
        self.refs = refs
        """project directory (posix, relative to the repo root; "" for the root) -> the
        directories of the projects it references."""
        self._owner_cache: dict[str, str | None] = {}
        self._reach_cache: dict[str, frozenset[str]] = {}

    def __bool__(self) -> bool:
        return bool(self.refs)

    def project_of(self, rel_path: str) -> str | None:
        """Directory of the nearest enclosing project, or None for a loose file."""
        directory = posixpath.dirname(rel_path)
        cached = self._owner_cache.get(directory)
        if cached is not None or directory in self._owner_cache:
            return cached
        probe = directory
        owner: str | None = None
        while True:
            if probe in self.refs:
                owner = probe
                break
            if not probe:
                break
            probe = posixpath.dirname(probe)
        self._owner_cache[directory] = owner
        return owner

    def reachable(self, project: str) -> frozenset[str]:
        """The project itself and everything it references, transitively."""
        cached = self._reach_cache.get(project)
        if cached is not None:
            return cached
        seen: set[str] = set()
        stack = [project]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(self.refs.get(cur, ()))
        result = frozenset(seen)
        self._reach_cache[project] = result
        return result

    @classmethod
    def scan(cls, root: Path) -> ProjectMap:
        """Read every `.csproj` under `root`. Unreadable or odd project files are
        skipped; the resolver then falls back to proximity for the files involved."""
        refs: dict[str, list[str]] = {}
        root = root.resolve()
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                if not name.endswith(".csproj"):
                    continue
                path = Path(dirpath) / name
                rel_dir = Path(dirpath).relative_to(root).as_posix()
                rel_dir = "" if rel_dir == "." else rel_dir
                refs.setdefault(rel_dir, [])
                try:
                    if path.stat().st_size > _MAX_PROJECT_FILE_BYTES:
                        continue
                    text = path.read_text(encoding="utf-8-sig", errors="ignore")
                except OSError:
                    continue
                for include in _PROJECT_REFERENCE.findall(text):
                    target = _resolve_reference(rel_dir, include)
                    if target is not None:
                        refs[rel_dir].append(target)
        return cls({k: tuple(dict.fromkeys(v)) for k, v in refs.items()})


def _resolve_reference(project_dir: str, include: str) -> str | None:
    """`..\\Foo\\Foo.csproj` (from `src/Bar`) -> `src/Foo`. MSBuild properties other than
    `$(MSBuildThisFileDirectory)` cannot be evaluated here, so such references are skipped."""
    include = include.replace("\\", "/").replace("$(MSBuildThisFileDirectory)", "")
    if "$(" in include:
        return None
    target_file = posixpath.normpath(posixpath.join(project_dir, include))
    if target_file.startswith(".."):
        return None
    directory = posixpath.dirname(target_file)
    return "" if directory == "." else directory
