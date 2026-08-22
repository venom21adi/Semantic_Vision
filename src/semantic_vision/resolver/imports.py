"""Resolves per-file import statements into bindings usable by call
resolution, and produces the `imports` graph edges.

An import can resolve to:
- a specific in-repo symbol (`from pkg.mod import func`)
- an in-repo module as a whole (`import pkg.mod`, or a submodule import)
- an external target (stdlib or third-party -- we don't distinguish the
  two, per the build plan, since both are simply "not part of this repo")
- ambiguous, when the module is local but the imported name can't be
  matched to a known top-level symbol (e.g. importing a variable, or a
  name we don't track) or when a star import is used
"""

from __future__ import annotations

from dataclasses import dataclass

from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import RawImport, RawModule
from semantic_vision.resolver.symbol_table import ModuleIndex


@dataclass
class ImportBinding:
    local_name: str
    dotted_prefix: str | None
    """The dotted path (local or external) reachable through
    `local_name`, e.g. "pkg" for `import pkg.sub.mod` (no asname) or
    "pkg.sub.mod" for `import pkg.sub.mod as m`. Appending further
    attribute access (`.rest`) to this and re-resolving against the
    repo's module table is how multi-hop attribute chains like
    `pkg.sub.mod.deep()` get resolved. `None` when this binding is a
    single resolved symbol (`symbol_id` set) with no module namespace
    behind it, or when nothing could be determined."""
    symbol_id: str | None
    """Resolved node id, when a specific function/class was imported."""
    external: bool
    ambiguous: bool


@dataclass
class ImportResolution:
    bindings: dict[str, ImportBinding]
    edges: list[Edge]


def _resolve_relative_module(rel_path: str, module: str | None, level: int) -> str:
    if level == 0:
        return module or ""
    package_parts = rel_path.split("/")[:-1]
    extra_up = level - 1
    if extra_up:
        package_parts = package_parts[:-extra_up]
    base = ".".join(package_parts)
    if module:
        return f"{base}.{module}" if base else module
    return base


def resolve_imports(
    rel_path: str,
    raw: RawModule,
    module_by_dotted: dict[str, str],
    modules: dict[str, ModuleIndex],
) -> ImportResolution:
    bindings: dict[str, ImportBinding] = {}
    edges: list[Edge] = []

    for imp in raw.imports:
        if imp.is_star:
            module_dotted = _resolve_relative_module(rel_path, imp.module, imp.level)
            if module_dotted in module_by_dotted:
                edges.append(
                    Edge(
                        source=rel_path,
                        target=module_by_dotted[module_dotted],
                        kind=EdgeKind.IMPORTS,
                        ambiguous=True,
                    )
                )
            else:
                edges.append(
                    Edge(
                        source=rel_path,
                        target=f"external::{module_dotted or '?'}",
                        kind=EdgeKind.IMPORTS,
                        external=True,
                        ambiguous=True,
                    )
                )
            continue

        # A bare `import x` always has module=None and level=0. A
        # relative from-import (`from . import x`, `from .. import x`)
        # *also* has module=None but level > 0 -- it must be dispatched
        # as a from-import, not a plain import, or it gets misread as an
        # absolute top-level module named "x".
        if imp.module is None and imp.level == 0:
            _bind_plain_import(rel_path, imp, module_by_dotted, bindings, edges)
        else:
            _bind_from_import(rel_path, imp, module_by_dotted, modules, bindings, edges)

    return ImportResolution(bindings=bindings, edges=edges)


def _bind_plain_import(
    rel_path: str,
    imp: RawImport,
    module_by_dotted: dict[str, str],
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    dotted = imp.name
    root = dotted.split(".")[0]
    local_name = imp.asname or root
    # Without an `as`, only the root package name is bound (Python makes
    # the rest reachable via attribute access once imported); with an
    # `as`, the name binds directly to the leaf module.
    dotted_prefix = dotted if imp.asname else root

    if dotted in module_by_dotted:
        edges.append(Edge(source=rel_path, target=module_by_dotted[dotted], kind=EdgeKind.IMPORTS))
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=dotted_prefix,
            symbol_id=None,
            external=False,
            ambiguous=False,
        )
    else:
        edges.append(
            Edge(
                source=rel_path,
                target=f"external::{dotted}",
                kind=EdgeKind.IMPORTS,
                external=True,
            )
        )
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=dotted_prefix,
            symbol_id=None,
            external=True,
            ambiguous=False,
        )


def _bind_from_import(
    rel_path: str,
    imp: RawImport,
    module_by_dotted: dict[str, str],
    modules: dict[str, ModuleIndex],
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    module_dotted = _resolve_relative_module(rel_path, imp.module, imp.level)
    local_name = imp.asname or imp.name

    if module_dotted not in module_by_dotted:
        qualname = f"{module_dotted}.{imp.name}" if module_dotted else imp.name
        edges.append(
            Edge(
                source=rel_path,
                target=f"external::{qualname}",
                kind=EdgeKind.IMPORTS,
                external=True,
            )
        )
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=qualname,
            symbol_id=None,
            external=True,
            ambiguous=False,
        )
        return

    target_rel = module_by_dotted[module_dotted]
    target_index = modules.get(target_rel)
    symbol_id = None
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

    sub_dotted = f"{module_dotted}.{imp.name}" if module_dotted else imp.name
    if sub_dotted in module_by_dotted:
        edges.append(
            Edge(source=rel_path, target=module_by_dotted[sub_dotted], kind=EdgeKind.IMPORTS)
        )
        bindings[local_name] = ImportBinding(
            local_name=local_name,
            dotted_prefix=sub_dotted,
            symbol_id=None,
            external=False,
            ambiguous=False,
        )
        return

    # Module resolves locally, but the imported name isn't a top-level
    # symbol or submodule we recognize (e.g. a variable import, or a name
    # re-exported through another import we don't chase transitively).
    edges.append(Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS, ambiguous=True))
    bindings[local_name] = ImportBinding(
        local_name=local_name,
        dotted_prefix=None,
        symbol_id=None,
        external=False,
        ambiguous=True,
    )
