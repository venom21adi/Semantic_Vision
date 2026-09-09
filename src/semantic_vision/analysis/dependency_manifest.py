"""Declared-dependency manifest parsing (see docs/ideas/REPO-INTELLIGENCE-IDEAS.md's
Idea 3): reads whichever dependency manifest already exists at a repo's root
-- `pyproject.toml`/`requirements.txt` for Python, `package.json` for JS/TS
-- for package name + declared version constraint, the input
`analysis/osv_client.py` needs to query a vulnerability feed. Also joins
that against the resolver's own `external::{qualname}` edge targets (see
`resolver/imports.py`, [EDGE-KINDS.md](../../../docs/EDGE-KINDS.md)) so only
packages this repo's code *actually imports* -- not everything a manifest
merely lists -- get queried.

Best-effort only: a manifest's version field is usually a *constraint*
(">=1.2.3", "^2.0.0"), not the exact version actually installed --
resolving that precisely would need a lockfile (`uv.lock`,
`package-lock.json`, ...), which this pass doesn't parse. The lower bound
extracted here is a reasonable approximation, not a guarantee of what's
really running; a known, documented simplification, not a silent one.
Likewise, an import's name can differ from its distribution/package name
(Python's `import yaml` vs. the `PyYAML` package on PyPI) -- this pass only
matches on exact (lowercased) name, so a mismatch like that silently isn't
reported, rather than being incorrectly reported.
"""

from __future__ import annotations

import json
import re
import tomllib
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DeclaredPackage:
    name: str
    version: str | None
    ecosystem: str
    """An OSV ecosystem name (https://ossf.github.io/osv-schema/#affectedpackage-field)
    -- `"PyPI"` or `"npm"`, the two manifest kinds this pass understands."""


_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]+")
_VERSION_TOKEN_RE = re.compile(r"\d[\w.\-]*")


def _extract_version(spec: str) -> str | None:
    """Best-effort: the first version-looking token in a constraint string
    (`">=1.2.3"` -> `"1.2.3"`, `"^2.0.0"` -> `"2.0.0"`) -- see this module's
    own docstring for why this is an approximation, not an exact resolve.
    `None` for anything containing a URL scheme (`pkg @ git+https://...`,
    a direct-reference PEP 508 dependency) -- the first digit-led token in
    a git tag or commit-ish (`.../pkg.git@v1.2.3`) is not this package's
    own version, it just happens to look like one."""
    if "://" in spec:
        return None
    match = _VERSION_TOKEN_RE.search(spec)
    return match.group(0) if match else None


def parse_pyproject(path: Path) -> dict[str, DeclaredPackage]:
    """PEP 621 `[project.dependencies]` only -- this project's own scope,
    not `[tool.poetry.dependencies]` or other build-backend-specific
    tables, a deliberate scope cut for tonight."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        data = tomllib.loads(raw)
    except tomllib.TOMLDecodeError:
        return {}

    project = data.get("project")
    specs = project.get("dependencies") if isinstance(project, dict) else None
    if not isinstance(specs, list):
        return {}

    packages: dict[str, DeclaredPackage] = {}
    for spec in specs:
        if not isinstance(spec, str):
            continue
        name_match = _NAME_RE.match(spec)
        if not name_match:
            continue
        name = name_match.group(0)
        version = _extract_version(spec[len(name) :])
        packages[name.lower()] = DeclaredPackage(name=name, version=version, ecosystem="PyPI")
    return packages


def parse_requirements_txt(path: Path) -> dict[str, DeclaredPackage]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}

    packages: dict[str, DeclaredPackage] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "-", ".")):
            continue
        # A VCS or direct URL install (`git+https://.../pkg.git@v1.2.3#egg=pkg`,
        # `https://example.com/pkg.whl`) -- skipped entirely, not just
        # version-neutered: `_NAME_RE` would otherwise match a meaningless
        # prefix like "git" as if it were the package name, which is a
        # real wrong-package misattribution, not just a missing version.
        if "://" in stripped:
            continue
        name_match = _NAME_RE.match(stripped)
        if not name_match:
            continue
        name = name_match.group(0)
        version = _extract_version(stripped[len(name) :])
        packages[name.lower()] = DeclaredPackage(name=name, version=version, ecosystem="PyPI")
    return packages


def parse_package_json(path: Path) -> dict[str, DeclaredPackage]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}

    packages: dict[str, DeclaredPackage] = {}
    for section in ("dependencies", "devDependencies"):
        deps = data.get(section)
        if not isinstance(deps, dict):
            continue
        for name, spec in deps.items():
            if not isinstance(name, str) or not isinstance(spec, str):
                continue
            packages[name.lower()] = DeclaredPackage(
                name=name, version=_extract_version(spec), ecosystem="npm"
            )
    return packages


def find_declared_dependencies(root: Path) -> dict[str, DeclaredPackage]:
    """Auto-locates whichever manifest(s) exist at `root` and merges their
    declared packages, keyed by lowercased package name. A repo with both a
    Python and a JS/TS manifest (e.g. this project's own `pyproject.toml` +
    `frontend/package.json`) gets both -- not an either/or choice."""
    packages: dict[str, DeclaredPackage] = {}
    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        packages.update(parse_pyproject(pyproject))
    requirements = root / "requirements.txt"
    if requirements.is_file():
        packages.update(parse_requirements_txt(requirements))
    package_json = root / "package.json"
    if package_json.is_file():
        packages.update(parse_package_json(package_json))
    return packages


def _package_name_from_qualname(qualname: str) -> str:
    """The package name a resolver-produced qualname belongs to: a scoped
    npm import (`@scope/pkg` or `@scope/pkg/sub/path`) is *two* `/`-
    separated segments, not one -- npm/node module resolution always
    treats `@scope/pkg` as the package identity, matching exactly how
    `package.json` itself declares it (`"@babel/core": "..."`, never a
    bare `"@babel"` key). Any other import (Python's dotted qualnames, or
    an unscoped JS import with a sub-path like `lodash/fp`) uses its
    first dotted-or-slashed segment as before."""
    if qualname.startswith("@"):
        parts = qualname.split("/")
        if len(parts) >= 2:
            return f"{parts[0]}/{parts[1]}"
        return parts[0]
    return qualname.split(".")[0].split("/")[0]


def resolve_used_dependencies(
    external_targets: Iterable[str], declared: dict[str, DeclaredPackage]
) -> list[DeclaredPackage]:
    """Cross-references `external::{qualname}` edge targets against
    `declared` -- only packages that are *both* actually imported by this
    repo's code *and* declared in a manifest are returned, the
    differentiator this feature has over a plain manifest-only audit tool
    (which reports everything declared, used or not). See
    `_package_name_from_qualname` for how a qualname maps to a package
    name."""
    used_names: set[str] = set()
    for target in external_targets:
        qualname = target.removeprefix("external::")
        top_level = _package_name_from_qualname(qualname)
        if top_level:
            used_names.add(top_level.lower())

    resolved = [declared[name] for name in used_names if name in declared]
    resolved.sort(key=lambda pkg: pkg.name.lower())
    return resolved
