"""Resolves per-file Go import statements into bindings and `imports`
graph edges -- the Go counterpart to `resolver/java_imports.py`.

Two things make Go different from the file-per-module languages:

1. **A Go package is a directory, not a file.** An import path names a
   *package directory*, so a local import resolves to that directory's
   graph node (`internal/util`), and calls through the imported name
   (`util.Helper()`) are looked up across every file in that directory --
   see `languages/go.py` for the call side.
2. **Which import paths are local depends on `go.mod`.** `github.com/me/app/
   internal/util` is local to a repo whose `go.mod` says `module
   github.com/me/app`, but identical-looking third-party paths exist. The
   adapter's `bind_root` hook reads every `go.mod` under the repo root and
   passes the `{module root dir: module path}` map in here. With no
   `go.mod` found it falls back to matching an import path's trailing
   segments against known package directories, skipping standard-library
   roots -- a heuristic, documented as one.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import RawImport, RawModule
from semantic_vision.resolver.imports import ImportBinding, ImportResolution
from semantic_vision.resolver.symbol_table import ModuleIndex

# Top-level standard-library import roots, used only by the no-`go.mod`
# fallback so a stdlib import like "net/http" is never mistaken for a local
# directory that happens to end in `/http`.
GO_STDLIB_ROOTS = frozenset(
    {
        "archive", "bufio", "builtin", "bytes", "cmp", "compress", "container",
        "context", "crypto", "database", "debug", "embed", "encoding", "errors",
        "expvar", "flag", "fmt", "go", "hash", "html", "image", "index", "io",
        "iter", "log", "maps", "math", "mime", "net", "os", "path", "plugin",
        "reflect", "regexp", "runtime", "slices", "sort", "strconv", "strings",
        "structs", "sync", "syscall", "testing", "text", "time", "unicode",
        "unique", "unsafe", "weak",
    }
)  # fmt: skip

_MAJOR_VERSION_SEGMENT = re.compile(r"^v\d+$")
_GOPKG_VERSION_SUFFIX = re.compile(r"\.v\d+$")
_MODULE_LINE = re.compile(r"^\s*module\s+(\S+)", re.MULTILINE)

# Walking for nested `go.mod` files (multi-module repos, `go.work`) is
# bounded: a deep walk of a huge repo over a slow Docker bind mount costs
# far more than the rare deeper module is worth.
_GO_MOD_SEARCH_DEPTH = 3
_GO_MOD_SKIP_DIRS = frozenset({"vendor", "node_modules", "testdata", "__pycache__"})


def dotted_module_path(rel_path: str) -> str:
    """"internal/util/helpers.go" -> "internal.util.helpers". Go has no
    file-collapse rule (no `__init__.py` analogue): packages are resolved by
    directory, never by this dotted path -- it exists only to key the shared
    symbol table's per-file index."""
    return rel_path.removesuffix(".go").replace("/", ".")


def find_go_modules(root: Path) -> dict[str, str]:
    """`{directory relative to root ("" for the root itself): module path}`
    for every `go.mod` within `_GO_MOD_SEARCH_DEPTH` levels of `root`."""
    modules: dict[str, str] = {}
    root = Path(root)
    base_depth = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root):
        depth = len(Path(dirpath).parts) - base_depth
        dirnames[:] = [
            d
            for d in dirnames
            if not d.startswith(".") and d not in _GO_MOD_SKIP_DIRS and depth < _GO_MOD_SEARCH_DEPTH
        ]
        if "go.mod" not in filenames:
            continue
        try:
            text = (Path(dirpath) / "go.mod").read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        match = _MODULE_LINE.search(text)
        if match is None:
            continue
        rel = Path(dirpath).relative_to(root).as_posix()
        modules["" if rel == "." else rel] = match.group(1).strip('"`')
    return modules


def default_package_name(import_path: str) -> str:
    """The identifier an un-aliased import binds, guessed from the path
    (the package clause itself is not available at resolution time):
    `net/http` -> `http`, `example.com/lib/v2` -> `lib`, `gopkg.in/yaml.v3`
    -> `yaml`, `github.com/x/go-foo` stays `go-foo` (not a valid identifier
    either way -- calls through it simply won't match)."""
    parts = import_path.split("/")
    name = parts[-1]
    if _MAJOR_VERSION_SEGMENT.match(name) and len(parts) > 1:
        name = parts[-2]
    return _GOPKG_VERSION_SUFFIX.sub("", name)


def local_package_dir(
    import_path: str, go_modules: dict[str, str], package_dirs: set[str]
) -> str | None:
    """The repo-relative package directory `import_path` refers to, or
    `None` if it isn't local (standard library, third party, or a package
    directory that holds no parsed `.go` files)."""
    if go_modules:
        # Longest module path first: a nested module's path extends its
        # parent's, and must win for imports under it.
        for root_dir, module_path in sorted(go_modules.items(), key=lambda kv: -len(kv[1])):
            if import_path == module_path:
                relative = ""
            elif import_path.startswith(module_path + "/"):
                relative = import_path[len(module_path) + 1 :]
            else:
                continue
            candidate = "/".join(p for p in (root_dir, relative) if p)
            return candidate if candidate in package_dirs else None
        return None

    if import_path.split("/", 1)[0] in GO_STDLIB_ROOTS:
        return None
    best: str | None = None
    for directory in package_dirs:
        if not directory:
            continue
        if import_path == directory or import_path.endswith("/" + directory):
            if best is None or len(directory) > len(best):
                best = directory
    return best


def package_dirs_of(modules: dict[str, ModuleIndex]) -> set[str]:
    """Every directory holding at least one discovered `.go` file ("" is the
    repo root)."""
    return {rel.rpartition("/")[0] for rel in modules}


def make_resolve_imports(go_modules: dict[str, str]):  # noqa: ANN201
    """Builds the adapter's `resolve_imports`, closed over the repo's
    `go.mod` map (empty -> heuristic fallback)."""

    def resolve_imports(
        rel_path: str,
        raw: RawModule,
        module_by_dotted: dict[str, str],
        modules: dict[str, ModuleIndex],
    ) -> ImportResolution:
        del module_by_dotted  # Go resolves by package directory, not file path.
        bindings: dict[str, ImportBinding] = {}
        edges: list[Edge] = []
        package_dirs = package_dirs_of(modules)
        for imp in raw.imports:
            _bind_import(rel_path, imp, go_modules, package_dirs, bindings, edges)
        return ImportResolution(bindings=bindings, edges=edges)

    return resolve_imports


def _bind_import(
    rel_path: str,
    imp: RawImport,
    go_modules: dict[str, str],
    package_dirs: set[str],
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    import_path = imp.module or ""
    package_dir = local_package_dir(import_path, go_modules, package_dirs)

    if package_dir is None:
        edges.append(
            Edge(
                source=rel_path,
                target=f"external::{import_path}",
                kind=EdgeKind.IMPORTS,
                external=True,
            )
        )
        if imp.asname in ("_", "."):
            # Blank import: side effects only. Dot import: names land
            # unqualified in file scope, which can't be tracked -- calls
            # through them stay unresolved rather than guessed.
            return
        local_name = imp.asname or default_package_name(import_path)
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=import_path,
            symbol_id=None,
            external=True,
            ambiguous=False,
        )
        return

    # A repo-root package has no directory node to point an edge at.
    if package_dir:
        edges.append(Edge(source=rel_path, target=package_dir, kind=EdgeKind.IMPORTS))
    if imp.asname in ("_", "."):
        return
    local_name = imp.asname or default_package_name(import_path)
    bindings[local_name] = ImportBinding(
        local_name=local_name,
        dotted_prefix=package_dir,
        symbol_id=None,
        external=False,
        ambiguous=False,
    )
