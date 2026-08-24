"""Resolves per-file JS/TS import statements into bindings and `imports`
graph edges -- the JS/TS counterpart to `resolver/imports.py`.

Reuses `ImportBinding`/`ImportResolution` from `resolver/imports.py`
directly: their shape (`local_name`/`dotted_prefix`/`symbol_id`/
`external`/`ambiguous`) is already language-agnostic, built around one
idea -- every module has a canonical *dotted path*, and everything
downstream (`module_by_dotted`, `resolver/calls.py`'s dotted-chain walk
in `_resolve_via_binding`) works off that idea alone, not off anything
Python-specific. Only *how* a dotted path is computed differs: Python
collapses `__init__.py`; JS collapses a trailing `index` file and knows
its own family of extensions.

Does not reuse Python's `_bind_plain_import`/`_bind_from_import` --
those are shaped around Python's `level: int` + bare-vs-from split,
which has no equivalent in JS's specifier-string model (`"./x"`,
`"../y/z"`, `"lodash"`).
"""

from __future__ import annotations

from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser import javascript_extractor
from semantic_vision.parser.extractor import RawImport, RawModule
from semantic_vision.resolver.imports import ImportBinding, ImportResolution
from semantic_vision.resolver.symbol_table import ModuleIndex

FILE_EXTENSIONS = frozenset(javascript_extractor.GRAMMAR_BY_EXTENSION)
_EXTENSIONS_BY_LENGTH = sorted(FILE_EXTENSIONS, key=len, reverse=True)


def _strip_extension(segment: str) -> str:
    for ext in _EXTENSIONS_BY_LENGTH:
        if segment.endswith(ext):
            return segment[: -len(ext)]
    return segment


def _collapse_index(segments: list[str]) -> list[str]:
    """Drop a trailing "index" segment -- JS's `__init__.py`-collapsing
    equivalent, so a directory's index file and the directory itself
    share one dotted path."""
    if segments and segments[-1] == "index":
        return segments[:-1]
    return segments


def dotted_module_path(rel_path: str) -> str:
    """"src/utils/index.ts" -> "src.utils"; "src/utils/helper.ts" ->
    "src.utils.helper"."""
    parts = rel_path.split("/")
    parts[-1] = _strip_extension(parts[-1])
    parts = _collapse_index(parts)
    return ".".join(parts)


def _resolve_relative_specifier(rel_path: str, specifier: str) -> str:
    """Only called when `specifier.startswith(".")`. Walks leading
    "."/".." path segments to compute an up-count against `rel_path`'s
    own directory (the path-segment analogue of `resolver/imports.py`'s
    `_resolve_relative_module`, which counts a `level` int instead),
    then strips an extension and collapses a trailing "index" on the
    remainder -- the same rule `dotted_module_path` applies on the
    definition side, so both sides agree on one dotted string regardless
    of which extension the target file actually has."""
    package_parts = rel_path.split("/")[:-1]
    segments = specifier.split("/")

    idx = 0
    up_levels = 0
    while idx < len(segments) and segments[idx] in (".", ".."):
        if segments[idx] == "..":
            up_levels += 1
        idx += 1

    if up_levels:
        package_parts = package_parts[:-up_levels] if up_levels <= len(package_parts) else []

    # A trailing slash (e.g. "./") splits to a trailing "" segment --
    # drop it rather than joining a dangling "." into the dotted path.
    remaining = [s for s in segments[idx:] if s]
    if remaining:
        remaining[-1] = _strip_extension(remaining[-1])
        remaining = _collapse_index(remaining)

    return ".".join(package_parts + remaining)


def resolve_imports(
    rel_path: str,
    raw: RawModule,
    module_by_dotted: dict[str, str],
    modules: dict[str, ModuleIndex],
) -> ImportResolution:
    bindings: dict[str, ImportBinding] = {}
    edges: list[Edge] = []

    for imp in raw.imports:
        specifier = imp.module if imp.module is not None else imp.name
        is_relative = specifier.startswith(".")

        if is_relative:
            dotted = _resolve_relative_specifier(rel_path, specifier)
            target_rel = module_by_dotted.get(dotted)
        else:
            dotted = None
            target_rel = None

        if imp.module is None:
            # Side-effect-only import (`import "./styles.css"` /
            # `import "some-polyfill"`) -- nothing to bind, just an edge.
            if target_rel is not None:
                edges.append(Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS))
            else:
                edges.append(
                    Edge(
                        source=rel_path,
                        target=f"external::{specifier}",
                        kind=EdgeKind.IMPORTS,
                        external=True,
                    )
                )
            continue

        if target_rel is not None:
            _bind_local(rel_path, imp, dotted, target_rel, modules, bindings, edges)
        else:
            _bind_external(rel_path, imp, specifier, bindings, edges)

    return ImportResolution(bindings=bindings, edges=edges)


def _bind_local(
    rel_path: str,
    imp: RawImport,
    module_dotted: str,
    target_rel: str,
    modules: dict[str, ModuleIndex],
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    if imp.name == "*":
        # A JS namespace import binds the whole module as an object
        # (`ns.foo()` resolves through it) -- structurally Python's
        # plain `import pkg.mod`, not Python's `from x import *`, so
        # the whole module is genuinely captured, not a guess.
        local_name = imp.asname or imp.name
        edges.append(Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS))
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=module_dotted,
            symbol_id=None,
            external=False,
            ambiguous=False,
        )
        return

    local_name = imp.asname or imp.name

    symbol_id = None
    if imp.name != "default":
        target_index = modules.get(target_rel)
        if target_index is not None:
            symbol_id = target_index.functions.get(imp.name) or target_index.classes.get(imp.name)

    if symbol_id:
        edges.append(Edge(source=rel_path, target=symbol_id, kind=EdgeKind.IMPORTS))
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=None,
            symbol_id=symbol_id,
            external=False,
            ambiguous=False,
        )
        return

    # The module resolves locally, but the extractor only captures
    # *import* statements, not what the target file's declarations (or,
    # for a default import, its `export default`) actually bind -- an
    # anonymous function, a re-export, an object literal are all valid
    # and none are distinguishable from here. Honest fallback: ambiguous,
    # not a guess.
    edges.append(Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS, ambiguous=True))
    bindings[local_name] = ImportBinding(
        local_name=local_name,
        dotted_prefix=None,
        symbol_id=None,
        external=False,
        ambiguous=True,
    )


def _bind_external(
    rel_path: str,
    imp: RawImport,
    specifier: str,
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    local_name = imp.asname or imp.name
    dotted_prefix = specifier if imp.name in ("*", "default") else f"{specifier}.{imp.name}"

    edges.append(
        Edge(source=rel_path, target=f"external::{specifier}", kind=EdgeKind.IMPORTS, external=True)
    )
    bindings[local_name] = ImportBinding(
        local_name=local_name,
        dotted_prefix=dotted_prefix,
        symbol_id=None,
        external=True,
        ambiguous=False,
    )
