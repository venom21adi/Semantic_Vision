"""The Go `LanguageAdapter` -- glues `parser/go_extractor.py` and
`resolver/go_imports.py` together, plus the one piece of resolution that is
genuinely Go-specific: **package-scoped name lookup**.

In Go all files of a directory form one package sharing a single
namespace, so `Helper()` in `a.go` may refer to a function in `b.go`, and
`func (s *Server) Run()` may call `s.helper()` defined in another file.
The shared `resolve_calls` only sees one file's `ModuleIndex`, so it
reports those as `unresolved::...`; `_resolve_package_scope` then retries
exactly those edges against the sibling files of the same package (or of
the imported local package, for `util.Helper()`), turning them into real
edges. Anything still not found stays `unresolved` -- never guessed.

Unlike the other adapters this one uses `bind_root`, because telling a local
import from a third-party one needs the repo's `go.mod` module path.
"""

from __future__ import annotations

import dataclasses
import functools
from pathlib import Path

from semantic_vision.languages.base import LanguageAdapter, ParseSyntaxError
from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser import go_extractor
from semantic_vision.parser.extractor import RawFunction, RawModule
from semantic_vision.resolver import go_imports
from semantic_vision.resolver.calls import resolve_calls
from semantic_vision.resolver.imports import ImportBinding
from semantic_vision.resolver.symbol_table import ModuleIndex

FILE_EXTENSIONS = go_extractor.FILE_EXTENSIONS

# `vendor` holds copies of third-party dependencies and `testdata` holds
# fixtures the Go toolchain itself ignores -- neither is the repo's own code.
EXCLUDED_DIRS = frozenset({"vendor", "testdata"})

# Predeclared identifiers (builtin functions and types). Type conversions
# like `int(x)` and `[]byte(s)`-style `string(b)` parse as calls, so the
# predeclared types belong here too -- same as `external::builtins.int` for
# Python.
GO_BUILTIN_NAMES = frozenset(
    {
        # functions
        "append", "cap", "clear", "close", "complex", "copy", "delete", "imag",
        "len", "make", "max", "min", "new", "panic", "print", "println", "real",
        "recover",
        # types
        "any", "bool", "byte", "comparable", "complex64", "complex128", "error",
        "float32", "float64", "int", "int8", "int16", "int32", "int64", "rune",
        "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
    }
)  # fmt: skip

_UNRESOLVED = "unresolved::"
_MODULE_SCOPE = "<package-level>"


def parse_file(source: str, rel_path: str) -> RawModule:
    tree = go_extractor.parse_tree(source, rel_path)
    if tree.root_node.has_error:
        raise ParseSyntaxError(
            message=f"Syntax error while parsing {rel_path}",
            line=go_extractor.first_error_line(tree),
        )
    return go_extractor.extract_module(tree, rel_path)


def _dir_of(rel_path: str) -> str:
    return rel_path.rpartition("/")[0]


class _PackageIndex:
    """Directory -> that package's per-file `ModuleIndex`es, built once per
    `modules` dict (one per `parse_repository` call, since `bind_root` hands
    out a fresh adapter each time) rather than rescanned for every file."""

    def __init__(self) -> None:
        self._key: int | None = None
        self._by_dir: dict[str, list[ModuleIndex]] = {}
        self._methods_by_dir: dict[str, dict[str, list[str]]] = {}
        # Filled in as each file is parsed (see `record`), per directory.
        self.field_names: dict[str, set[str]] = {}
        self.embedding_types: set[tuple[str, str]] = set()
        self.type_names: dict[str, set[str]] = {}

    def record(self, rel_path: str, raw: RawModule) -> None:
        """Remember each struct's field names and which types embed another
        type, so `_unexported_method_candidates` can tell a field read from a
        method value and know when a method might be promoted."""
        directory = _dir_of(rel_path)
        fields = self.field_names.setdefault(directory, set())
        types = self.type_names.setdefault(directory, set())
        for cls in raw.classes:
            if not cls.declared_elsewhere:
                types.add(cls.name)
            for attr in cls.attributes:
                fields.add(attr.name)
                embedded = (attr.annotation or "").lstrip("*").split("[", 1)[0]
                if embedded.rsplit(".", 1)[-1] == attr.name:
                    self.embedding_types.add((directory, cls.name))

    def _ensure(self, modules: dict[str, ModuleIndex]) -> None:
        if self._key == id(modules):
            return
        self._by_dir = {}
        self._methods_by_dir = {}
        for rel_path, index in sorted(modules.items()):
            directory = _dir_of(rel_path)
            self._by_dir.setdefault(directory, []).append(index)
            named = self._methods_by_dir.setdefault(directory, {})
            for (_type_name, method_name), method_id in index.methods.items():
                named.setdefault(method_name, []).append(method_id)
        self._key = id(modules)

    def files_in(self, directory: str, modules: dict[str, ModuleIndex]) -> list[ModuleIndex]:
        self._ensure(modules)
        return self._by_dir.get(directory, [])

    def methods_named(
        self, directory: str, name: str, modules: dict[str, ModuleIndex]
    ) -> list[str]:
        """Ids of every method called `name` in the package at `directory`."""
        self._ensure(modules)
        return self._methods_by_dir.get(directory, {}).get(name, [])


def _lookup(
    parts: list[str],
    files: list[ModuleIndex],
    stub_ids: set[str],
    *,
    functions_only: bool = False,
) -> str | None:
    """Resolve `Name` or `Type.Method` against a package's files. Go forbids
    duplicate package-level names, so a real package has at most one hit --
    except that the extractor emits a methods-only stand-in class per file
    for a type declared elsewhere (`stub_ids`); a type name must resolve to
    the real declaration, never a stand-in."""
    if len(parts) == 2:
        for index in files:
            found = index.methods.get((parts[0], parts[1]))
            if found:
                return found
        return None
    if len(parts) != 1:
        return None
    stub_fallback: str | None = None
    for index in files:
        found = index.functions.get(parts[0])
        if found:
            return found
        if functions_only:
            continue
        class_id = index.classes.get(parts[0])
        if class_id is None:
            continue
        if class_id not in stub_ids:
            return class_id
        stub_fallback = stub_fallback or class_id
    return stub_fallback


# More candidates than this and an ambiguous edge to each would be noise, not
# information -- a generic name like `reset` defined on a dozen types.
_MAX_METHOD_CANDIDATES = 5


def _unexported_method_candidates(
    label: str,
    own_dir: str,
    modules: dict[str, ModuleIndex],
    package_index: _PackageIndex,
    local_prefixes: dict[str | None, ImportBinding],
) -> list[str]:
    """Candidate targets for `x.method(...)` where `x` is a variable of
    unknown type and `method` is **unexported**.

    Go only lets code in the *same package* call an unexported method, so
    the receiver's type must live in this package: the candidates are exactly
    the methods of that name defined here. An exported name proves nothing
    (it could belong to any imported type, `buf.String()`), so those are left
    alone. Several same-named methods are all returned, to be emitted as
    *ambiguous* edges rather than guessed between; past
    `_MAX_METHOD_CANDIDATES` none are, since that many edges say nothing.
    """
    parts = label.split(".")
    if len(parts) < 2:
        return []
    method = parts[-1]
    if not method or not method[0].islower() and method[0] != "_":
        return []
    if any(label.startswith(prefix + ".") for prefix in local_prefixes if prefix):
        return []
    # A field and a method can share a name on different types, and a read of
    # a field (`s.siteVector` as an argument) or a call of a func-typed field
    # looks exactly like a method value or call. If the name is a struct field
    # anywhere in this package it is too ambiguous to claim as a method.
    if method in package_index.field_names.get(own_dir, ()):
        return []
    # `this.m()` renders as `Type.m`. With the receiver type known and no `m`
    # declared on it, the only way the call is valid is a method *promoted*
    # from an embedded type, so don't fall back to every same-named method in
    # the package unless the type embeds something.
    if (
        len(parts) == 2
        and parts[0] in package_index.type_names.get(own_dir, ())
        and (own_dir, parts[0]) not in package_index.embedding_types
    ):
        return []
    candidates = package_index.methods_named(own_dir, method, modules)
    if not candidates or len(candidates) > _MAX_METHOD_CANDIDATES:
        return []
    return sorted(set(candidates))


def _resolve_package_scope(
    rel_path: str,
    edges: list[Edge],
    bindings: dict[str, ImportBinding],
    modules: dict[str, ModuleIndex],
    package_index: _PackageIndex,
    stub_ids: set[str],
) -> list[Edge]:
    own_dir = _dir_of(rel_path)
    local_prefixes = {
        b.dotted_prefix: b
        for b in bindings.values()
        if not b.external and b.dotted_prefix is not None
    }

    resolved: list[Edge] = []
    for edge in edges:
        if edge.kind != EdgeKind.CALLS or not edge.target.startswith(_UNRESOLVED):
            resolved.append(edge)
            continue
        label = edge.target.removeprefix(_UNRESOLVED)
        is_ref = label.startswith(go_extractor.REF_PREFIX)
        label = label.removeprefix(go_extractor.REF_PREFIX)
        target: str | None = None

        # `util.Helper` / `util.Type.Method` through a local-package import.
        # The shared resolver renders these as "<package dir>.<rest>".
        for prefix in local_prefixes:
            if label.startswith(prefix + "."):
                rest = label[len(prefix) + 1 :].split(".")
                target = _lookup(
                    rest,
                    package_index.files_in(prefix, modules),
                    stub_ids,
                    functions_only=is_ref,
                )
                break
        else:
            # Bare `Helper`, or `Type.method` from `this.method()`, within
            # the file's own package.
            if "this" not in label.split("."):
                target = _lookup(
                    label.split("."),
                    package_index.files_in(own_dir, modules),
                    stub_ids,
                    functions_only=is_ref and "." not in label,
                )

        if target is not None:
            resolved.append(Edge(source=edge.source, target=target, kind=EdgeKind.CALLS))
            continue

        if not is_ref or label.startswith(go_extractor.UNKNOWN_RECEIVER + "."):
            candidates = _unexported_method_candidates(
                label, own_dir, modules, package_index, local_prefixes
            )
            if candidates:
                resolved.extend(
                    Edge(source=edge.source, target=c, kind=EdgeKind.CALLS, ambiguous=True)
                    for c in candidates
                )
                continue

        if not is_ref:
            # A function-value reference that names nothing known is
            # simply not an edge (most are plain variables); an unresolved
            # *call* stays visible as `unresolved::...`.
            resolved.append(edge)
    return resolved


def _build_adapter(go_modules: dict[str, str]) -> LanguageAdapter:
    package_index = _PackageIndex()
    # Ids of methods-only stand-in classes (see `_lookup`), recorded as each
    # file is parsed. Per adapter, i.e. per `parse_repository` call.
    stub_ids: set[str] = set()

    def parse(source: str, rel_path: str) -> RawModule:
        raw = parse_file(source, rel_path)
        stub_ids.update(f"{rel_path}::{c.name}" for c in raw.classes if c.declared_elsewhere)
        package_index.record(rel_path, raw)
        return raw

    shared_resolve_calls = functools.partial(
        resolve_calls,
        self_names=frozenset({"this"}),
        builtin_names=GO_BUILTIN_NAMES,
        builtin_namespace="builtin",
    )

    def resolve_go_calls(
        rel_path: str,
        raw: RawModule,
        module_index: ModuleIndex,
        bindings: dict[str, ImportBinding],
        modules: dict[str, ModuleIndex],
        module_by_dotted: dict[str, str],
    ) -> list[Edge]:
        edges = shared_resolve_calls(
            rel_path, raw, module_index, bindings, modules, module_by_dotted
        )
        if raw.module_calls:
            # Package-level initializers have no enclosing function: resolve
            # them as the calls of a throwaway one, then attribute the
            # resulting edges to the file itself.
            holder = RawFunction(name=_MODULE_SCOPE, lineno=0, end_lineno=0)
            holder.calls = raw.module_calls
            scoped = RawModule(rel_path=rel_path, functions=[holder])
            for edge in shared_resolve_calls(
                rel_path, scoped, module_index, bindings, modules, module_by_dotted
            ):
                edges.append(edge.model_copy(update={"source": rel_path}))
        return _resolve_package_scope(
            rel_path, edges, bindings, modules, package_index, stub_ids
        )

    return LanguageAdapter(
        language_id="go",
        file_extensions=FILE_EXTENSIONS,
        parse_file=parse,
        dotted_module_path=go_imports.dotted_module_path,
        resolve_imports=go_imports.make_resolve_imports(go_modules),
        resolve_calls=resolve_go_calls,
        excluded_dirs=EXCLUDED_DIRS,
        bind_root=_bind_root,
    )


def _bind_root(root: Path) -> LanguageAdapter:
    adapter = _build_adapter(go_imports.find_go_modules(root))
    # The bound adapter has nothing further to bind.
    return dataclasses.replace(adapter, bind_root=None)


# The registered adapter works standalone (heuristic import matching, no
# `go.mod`); `parse_repository` swaps in the `go.mod`-aware one via
# `bind_root`.
GO_ADAPTER = _build_adapter({})
