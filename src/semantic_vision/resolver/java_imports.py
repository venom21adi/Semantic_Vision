"""Resolves per-file Java import statements into bindings and `imports`
graph edges -- the Java counterpart to `resolver/js_imports.py`.

Structurally simpler than both `js_imports.py` and `resolver/imports.py`,
for a reason specific to Java: it's one-public-class-per-file with
package-mirrors-directory, so a file's dotted path *is* already the
fully-qualified class name (`com/example/Greeter.java` ->
`com.example.Greeter`). An `import com.example.util.Formatter;` therefore
resolves by looking up `com.example.util.Formatter` *directly* in
`module_by_dotted` -- there's no separate "resolve the module, then look
up a symbol inside it" hop the way Python's `from pkg.mod import X` or
JS's `import { X } from './module'` need.

Reuses `ImportBinding`/`ImportResolution` from `resolver/imports.py`
unchanged, same as `js_imports.py` does -- their shape is already
language-agnostic.
"""

from __future__ import annotations

from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import RawImport, RawModule
from semantic_vision.resolver.imports import ImportBinding, ImportResolution
from semantic_vision.resolver.symbol_table import ModuleIndex

# Java's package-mirrors-directory convention holds relative to a
# *source root*, not the repository root -- a repo's package declarations
# never include that source root's own path segments (a file declaring
# `package com.example;` still says exactly that regardless of whether
# it lives at `com/example/Foo.java`, `src/com/example/Foo.java`, or
# Maven/Gradle's standard `src/main/java/com/example/Foo.java`). Since
# `dotted_module_path` gets no source access (the `LanguageAdapter`
# interface gives none) and can't read the file's actual `package`
# statement, it strips the longest of these conventional source-root
# prefixes that actually matches, longest-first so `src/main/java/` (or
# `src/test/java/`) is preferred over the bare `src/` it also starts
# with. A repo using some other custom source-root name won't resolve
# locally -- an honest fallback to `external`, not a crash -- since there
# is no path-only way to detect an arbitrary convention.
_CONVENTIONAL_SOURCE_ROOTS = ("src/main/java/", "src/test/java/", "src/")


def dotted_module_path(rel_path: str) -> str:
    """"com/example/Greeter.java" -> "com.example.Greeter";
    "src/main/java/com/example/Greeter.java" -> "com.example.Greeter". No
    `__init__.py`-style collapse is needed beyond the source-root strip
    above: Java has no equivalent "this file represents its containing
    directory" file (`package-info.java` is the closest analog, and is
    simply inert here -- its dotted path never matches a real class name
    during lookup)."""
    for root in _CONVENTIONAL_SOURCE_ROOTS:
        if rel_path.startswith(root):
            rel_path = rel_path[len(root) :]
            break
    parts = rel_path.split("/")
    parts[-1] = parts[-1].removesuffix(".java")
    return ".".join(parts)


def resolve_imports(
    rel_path: str,
    raw: RawModule,
    module_by_dotted: dict[str, str],
    modules: dict[str, ModuleIndex],
) -> ImportResolution:
    bindings: dict[str, ImportBinding] = {}
    edges: list[Edge] = []

    for imp in raw.imports:
        if imp.level == 1:
            _bind_static(rel_path, imp, module_by_dotted, modules, bindings, edges)
        elif imp.is_star:
            _bind_wildcard(rel_path, imp, modules, edges)
        else:
            _bind_type(rel_path, imp, module_by_dotted, modules, bindings, edges)

    return ImportResolution(bindings=bindings, edges=edges)


def _bind_type(
    rel_path: str,
    imp: RawImport,
    module_by_dotted: dict[str, str],
    modules: dict[str, ModuleIndex],
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    """`import a.b.C;` -- Java has no import aliasing, so the local name
    is always the imported class's own simple name."""
    full_dotted = f"{imp.module}.{imp.name}" if imp.module else imp.name
    local_name = imp.name
    target_rel = module_by_dotted.get(full_dotted)

    if target_rel is None:
        _bind_external(rel_path, local_name, full_dotted, bindings, edges)
        return

    target_index = modules.get(target_rel)
    symbol_id = target_index.classes.get(imp.name) if target_index is not None else None

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

    # The file resolves locally, but its top-level class name doesn't
    # match what was imported (an unusual but legal mismatch between file
    # name and the class actually declared in it, or a file that failed
    # to parse). Honest fallback: ambiguous, not a guess.
    edges.append(Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS, ambiguous=True))
    bindings[local_name] = ImportBinding(
        local_name=local_name, dotted_prefix=None, symbol_id=None, external=False, ambiguous=True
    )


def _bind_wildcard(
    rel_path: str,
    imp: RawImport,
    modules: dict[str, ModuleIndex],
    edges: list[Edge],
) -> None:
    """`import a.b.*;` -- no single file represents package `"a.b"`
    itself, but `build_symbol_table` already creates a directory node per
    path segment (id `"a/b"`) for every discovered file. No binding is
    added, mirroring Python's own star-import handling: later unqualified
    calls simply fall through to unresolved rather than guessing which of
    the package's classes was meant."""
    package_path = imp.module.replace(".", "/") if imp.module else ""
    prefix = f"{package_path}/"
    is_local = any(candidate.startswith(prefix) for candidate in modules)

    if is_local:
        edges.append(
            Edge(source=rel_path, target=package_path, kind=EdgeKind.IMPORTS, ambiguous=True)
        )
    else:
        edges.append(
            Edge(
                source=rel_path,
                target=f"external::{imp.module}.*",
                kind=EdgeKind.IMPORTS,
                external=True,
                ambiguous=True,
            )
        )


def _bind_static(
    rel_path: str,
    imp: RawImport,
    module_by_dotted: dict[str, str],
    modules: dict[str, ModuleIndex],
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    """`import static a.b.C.member;` / `import static a.b.C.*;` --
    `imp.module` is already the full class dotted path (see
    `java_extractor.py::_extract_import`'s table), so it's looked up
    directly, the same one-hop lookup `_bind_type` uses."""
    class_dotted = imp.module or ""
    target_rel = module_by_dotted.get(class_dotted)

    if target_rel is None:
        if imp.is_star:
            edges.append(
                Edge(
                    source=rel_path,
                    target=f"external::{class_dotted}.*",
                    kind=EdgeKind.IMPORTS,
                    external=True,
                    ambiguous=True,
                )
            )
        else:
            _bind_external(rel_path, imp.name, f"{class_dotted}.{imp.name}", bindings, edges)
        return

    if imp.is_star:
        # A static wildcard imports every static member of the class --
        # `ModuleIndex` has no way to enumerate "static methods" as a
        # distinct subset, so this stays a single ambiguous edge at the
        # class's file with no per-member bindings, structurally
        # identical to a package wildcard just targeting a class instead
        # of a directory.
        edges.append(
            Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS, ambiguous=True)
        )
        return

    target_index = modules.get(target_rel)
    class_simple = class_dotted.rsplit(".", 1)[-1]
    symbol_id = (
        target_index.methods.get((class_simple, imp.name)) if target_index is not None else None
    )

    if symbol_id:
        edges.append(Edge(source=rel_path, target=symbol_id, kind=EdgeKind.IMPORTS))
        bindings[imp.name] = ImportBinding(
            local_name=imp.name,
            dotted_prefix=None,
            symbol_id=symbol_id,
            external=False,
            ambiguous=False,
        )
        return

    # Not a known method -- most commonly a static *field* import
    # (`ModuleIndex` has no field index to check against), or a name
    # mismatch. Honest fallback: ambiguous, not a guess.
    edges.append(Edge(source=rel_path, target=target_rel, kind=EdgeKind.IMPORTS, ambiguous=True))
    bindings[imp.name] = ImportBinding(
        local_name=imp.name, dotted_prefix=None, symbol_id=None, external=False, ambiguous=True
    )


def _bind_external(
    rel_path: str,
    local_name: str,
    qualname: str,
    bindings: dict[str, ImportBinding],
    edges: list[Edge],
) -> None:
    edges.append(
        Edge(source=rel_path, target=f"external::{qualname}", kind=EdgeKind.IMPORTS, external=True)
    )
    bindings[local_name] = ImportBinding(
        local_name=local_name,
        dotted_prefix=qualname,
        symbol_id=None,
        external=True,
        ambiguous=False,
    )
