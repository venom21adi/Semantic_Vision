from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import RawCall, RawFunction, RawImport, RawModule
from semantic_vision.resolver.calls import resolve_calls
from semantic_vision.resolver.imports import ImportBinding
from semantic_vision.resolver.js_imports import (
    _resolve_relative_specifier,
    dotted_module_path,
    resolve_imports,
)
from semantic_vision.resolver.symbol_table import ModuleIndex


def test_dotted_module_path_strips_extension_for_a_regular_module():
    assert dotted_module_path("src/utils/helper.ts") == "src.utils.helper"


def test_dotted_module_path_collapses_index_file_to_its_directory_path():
    assert dotted_module_path("src/utils/index.ts") == "src.utils"


def test_dotted_module_path_handles_various_extensions():
    assert dotted_module_path("a/b.tsx") == "a.b"
    assert dotted_module_path("a/b.jsx") == "a.b"
    assert dotted_module_path("a/b.mjs") == "a.b"


def _module(rel_path: str, imports: list[RawImport] | None = None) -> RawModule:
    return RawModule(rel_path=rel_path, imports=imports or [])


def _index(
    rel_path: str, functions: dict | None = None, classes: dict | None = None
) -> ModuleIndex:
    return ModuleIndex(
        rel_path=rel_path,
        file_id=rel_path,
        dotted=dotted_module_path(rel_path),
        functions=functions or {},
        classes=classes or {},
    )


def test_named_import_resolves_to_a_local_function_symbol():
    module_by_dotted = {"src.helper": "src/helper.ts"}
    modules = {
        "src/helper.ts": _index("src/helper.ts", functions={"format": "src/helper.ts::format"})
    }
    raw = _module(
        "src/app.ts",
        [RawImport(module="./helper", name="format", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, modules)

    assert result.edges == [
        Edge(source="src/app.ts", target="src/helper.ts::format", kind=EdgeKind.IMPORTS)
    ]
    assert result.bindings == {
        "format": ImportBinding(
            local_name="format", dotted_prefix=None, symbol_id="src/helper.ts::format",
            external=False, ambiguous=False,
        )
    }


def test_named_import_with_asname_binds_the_local_alias():
    module_by_dotted = {"src.helper": "src/helper.ts"}
    modules = {
        "src/helper.ts": _index("src/helper.ts", classes={"Helper": "src/helper.ts::Helper"})
    }
    raw = _module(
        "src/app.ts",
        [RawImport(module="./helper", name="Helper", asname="H", level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, modules)

    assert result.bindings["H"].symbol_id == "src/helper.ts::Helper"
    assert "Helper" not in result.bindings


def test_relative_import_with_parent_traversal_resolves():
    module_by_dotted = {"a.x": "a/x.ts"}
    modules = {"a/x.ts": _index("a/x.ts", functions={"thing": "a/x.ts::thing"})}
    raw = _module(
        "a/b/c/file.ts",
        [RawImport(module="../../x", name="thing", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("a/b/c/file.ts", raw, module_by_dotted, modules)

    assert result.bindings["thing"].symbol_id == "a/x.ts::thing"


def test_relative_import_matches_an_index_file_without_writing_index():
    module_by_dotted = {"src.sub": "src/sub/index.ts"}
    modules = {
        "src/sub/index.ts": _index("src/sub/index.ts", functions={"go": "src/sub/index.ts::go"})
    }
    raw = _module(
        "src/app.ts",
        [RawImport(module="./sub", name="go", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, modules)

    assert result.bindings["go"].symbol_id == "src/sub/index.ts::go"


def test_relative_import_that_does_not_resolve_locally_is_external():
    raw = _module(
        "src/app.ts",
        [RawImport(module="./missing", name="thing", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, {}, {})

    assert result.edges == [
        Edge(
            source="src/app.ts", target="external::./missing", kind=EdgeKind.IMPORTS, external=True
        )
    ]
    assert result.bindings["thing"] == ImportBinding(
        local_name="thing", dotted_prefix="./missing.thing", symbol_id=None,
        external=True, ambiguous=False,
    )


def test_bare_specifier_named_import_is_external_with_no_resolution_attempt():
    module_by_dotted = {"lodash": "node_modules/lodash.js"}  # should never be consulted
    raw = _module(
        "src/app.ts",
        [RawImport(module="lodash", name="debounce", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, {})

    assert result.edges == [
        Edge(source="src/app.ts", target="external::lodash", kind=EdgeKind.IMPORTS, external=True)
    ]
    assert result.bindings["debounce"] == ImportBinding(
        local_name="debounce", dotted_prefix="lodash.debounce", symbol_id=None,
        external=True, ambiguous=False,
    )


def test_local_namespace_import_binds_the_whole_module_not_ambiguously():
    module_by_dotted = {"src.helper": "src/helper.ts"}
    modules = {
        "src/helper.ts": _index("src/helper.ts", functions={"format": "src/helper.ts::format"})
    }
    raw = _module(
        "src/app.ts",
        [RawImport(module="./helper", name="*", asname="ns", level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, modules)

    assert result.edges == [
        Edge(source="src/app.ts", target="src/helper.ts", kind=EdgeKind.IMPORTS)
    ]
    assert result.bindings["ns"] == ImportBinding(
        local_name="ns", dotted_prefix="src.helper", symbol_id=None,
        external=False, ambiguous=False,
    )


def test_external_namespace_import_binds_externally():
    raw = _module(
        "src/app.ts",
        [RawImport(module="react", name="*", asname="React", level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, {}, {})

    assert result.bindings["React"] == ImportBinding(
        local_name="React", dotted_prefix="react", symbol_id=None,
        external=True, ambiguous=False,
    )


def test_local_default_import_is_ambiguous_not_a_guess():
    module_by_dotted = {"src.helper": "src/helper.ts"}
    modules = {
        "src/helper.ts": _index("src/helper.ts", functions={"helper": "src/helper.ts::helper"})
    }
    raw = _module(
        "src/app.ts",
        [RawImport(module="./helper", name="default", asname="Helper", level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, modules)

    assert result.edges == [
        Edge(
            source="src/app.ts", target="src/helper.ts", kind=EdgeKind.IMPORTS, ambiguous=True
        )
    ]
    assert result.bindings["Helper"] == ImportBinding(
        local_name="Helper", dotted_prefix=None, symbol_id=None,
        external=False, ambiguous=True,
    )


def test_external_default_import_is_external_not_ambiguous():
    raw = _module(
        "src/app.ts",
        [RawImport(module="react", name="default", asname="React", level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, {}, {})

    assert result.bindings["React"] == ImportBinding(
        local_name="React", dotted_prefix="react", symbol_id=None,
        external=True, ambiguous=False,
    )


def test_named_import_that_misses_the_symbol_table_is_ambiguous():
    module_by_dotted = {"src.helper": "src/helper.ts"}
    modules = {"src/helper.ts": _index("src/helper.ts")}
    raw = _module(
        "src/app.ts",
        [RawImport(module="./helper", name="untracked", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, modules)

    assert result.bindings["untracked"].ambiguous is True
    assert result.edges[0].ambiguous is True


def test_side_effect_only_relative_import_produces_an_edge_with_no_binding():
    module_by_dotted = {"src.polyfill": "src/polyfill.ts"}
    raw = _module(
        "src/app.ts",
        [RawImport(module=None, name="./polyfill", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, {})

    assert result.edges == [
        Edge(source="src/app.ts", target="src/polyfill.ts", kind=EdgeKind.IMPORTS)
    ]
    assert result.bindings == {}


def test_side_effect_only_bare_import_is_external():
    raw = _module(
        "src/app.ts",
        [RawImport(module=None, name="reflect-metadata", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, {}, {})

    assert result.edges == [
        Edge(
            source="src/app.ts",
            target="external::reflect-metadata",
            kind=EdgeKind.IMPORTS,
            external=True,
        )
    ]
    assert result.bindings == {}


def test_resolve_relative_specifier_trailing_slash_does_not_leave_a_dangling_dot():
    """A specifier like "./" (directory import, no explicit index/name)
    splits to a trailing "" segment -- must not survive into the dotted
    path as a dangling ".", which would never match a real module."""
    assert _resolve_relative_specifier("src/greeter.ts", "./") == "src"
    assert _resolve_relative_specifier("a/b/c.ts", "../") == "a"


def test_local_import_whose_module_has_no_module_index_entry_is_ambiguous():
    """`module_by_dotted` recognizes the target as local, but `modules`
    has no entry for it (e.g. it failed to parse) -- must degrade to an
    ambiguous binding, not a KeyError."""
    module_by_dotted = {"src.helper": "src/helper.ts"}
    raw = _module(
        "src/app.ts",
        [RawImport(module="./helper", name="format", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("src/app.ts", raw, module_by_dotted, {})

    assert result.bindings["format"] == ImportBinding(
        local_name="format", dotted_prefix=None, symbol_id=None,
        external=False, ambiguous=True,
    )
    assert result.edges == [
        Edge(source="src/app.ts", target="src/helper.ts", kind=EdgeKind.IMPORTS, ambiguous=True)
    ]


def test_multi_hop_call_through_a_namespace_import_binding_resolves():
    """`import * as ns from "./pkg"` binds `ns` to the whole module's
    dotted path; a call like `ns.mod.thing()` should walk that dotted
    prefix through `module_by_dotted` the same way Python's own
    `import pkg.sub` + `pkg.sub.deep()` chains do -- `_resolve_via_binding`
    is fully reused, unmodified, from `resolver/calls.py`."""
    module_by_dotted = {"pkg.mod": "pkg/mod.ts"}
    modules = {
        "pkg/mod.ts": ModuleIndex(
            rel_path="pkg/mod.ts",
            file_id="pkg/mod.ts",
            dotted="pkg.mod",
            functions={"thing": "pkg/mod.ts::thing"},
        )
    }
    bindings = {
        "ns": ImportBinding(
            local_name="ns", dotted_prefix="pkg", symbol_id=None, external=False, ambiguous=False
        )
    }
    raw = RawModule(
        rel_path="app.ts",
        functions=[
            RawFunction(
                name="run", lineno=1, end_lineno=1, calls=[RawCall(dotted="ns.mod.thing", lineno=1)]
            )
        ],
    )
    module_index = ModuleIndex(rel_path="app.ts", file_id="app.ts", dotted="app")

    edges = resolve_calls(
        "app.ts", raw, module_index, bindings, modules, module_by_dotted,
        self_names=frozenset({"this"}),
    )

    assert edges == [
        Edge(source="app.ts::run", target="pkg/mod.ts::thing", kind=EdgeKind.CALLS)
    ]
