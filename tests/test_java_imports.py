from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import RawImport, RawModule
from semantic_vision.resolver.imports import ImportBinding
from semantic_vision.resolver.java_imports import dotted_module_path, resolve_imports
from semantic_vision.resolver.symbol_table import ModuleIndex


def test_dotted_module_path_joins_directories_with_dots():
    assert dotted_module_path("com/example/Greeter.java") == "com.example.Greeter"


def test_dotted_module_path_strips_bare_src_source_root():
    assert dotted_module_path("src/com/example/Greeter.java") == "com.example.Greeter"


def test_dotted_module_path_strips_maven_style_source_root():
    assert (
        dotted_module_path("src/main/java/com/example/Greeter.java") == "com.example.Greeter"
    )
    assert (
        dotted_module_path("src/test/java/com/example/GreeterTest.java")
        == "com.example.GreeterTest"
    )


def _module(rel_path: str, imports: list[RawImport] | None = None) -> RawModule:
    return RawModule(rel_path=rel_path, imports=imports or [])


def _index(
    rel_path: str,
    classes: dict | None = None,
    methods: dict | None = None,
) -> ModuleIndex:
    return ModuleIndex(
        rel_path=rel_path,
        file_id=rel_path,
        dotted=dotted_module_path(rel_path),
        classes=classes or {},
        methods=methods or {},
    )


def test_plain_type_import_resolves_to_a_local_class():
    module_by_dotted = {"com.example.util.Formatter": "com/example/util/Formatter.java"}
    modules = {
        "com/example/util/Formatter.java": _index(
            "com/example/util/Formatter.java",
            classes={"Formatter": "com/example/util/Formatter.java::Formatter"},
        )
    }
    raw = _module(
        "com/example/Caller.java",
        [RawImport(module="com.example.util", name="Formatter", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("com/example/Caller.java", raw, module_by_dotted, modules)

    assert result.edges == [
        Edge(
            source="com/example/Caller.java",
            target="com/example/util/Formatter.java::Formatter",
            kind=EdgeKind.IMPORTS,
        )
    ]
    assert result.bindings == {
        "Formatter": ImportBinding(
            local_name="Formatter",
            dotted_prefix=None,
            symbol_id="com/example/util/Formatter.java::Formatter",
            external=False,
            ambiguous=False,
        )
    }


def test_unresolvable_type_import_falls_back_external():
    raw = _module(
        "com/example/Caller.java",
        [RawImport(module="java.util", name="Objects", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("com/example/Caller.java", raw, {}, {})

    assert result.edges == [
        Edge(
            source="com/example/Caller.java",
            target="external::java.util.Objects",
            kind=EdgeKind.IMPORTS,
            external=True,
        )
    ]
    assert result.bindings["Objects"].external is True
    assert result.bindings["Objects"].dotted_prefix == "java.util.Objects"


def test_local_package_wildcard_resolves_ambiguously_to_the_directory_node():
    modules = {
        "com/example/util/Formatter.java": _index("com/example/util/Formatter.java"),
    }
    raw = _module(
        "com/example/Caller.java",
        [RawImport(module="com.example.util", name="*", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("com/example/Caller.java", raw, {}, modules)

    assert result.edges == [
        Edge(
            source="com/example/Caller.java",
            target="com/example/util",
            kind=EdgeKind.IMPORTS,
            ambiguous=True,
        )
    ]
    assert result.bindings == {}


def test_external_package_wildcard_resolves_ambiguously_external():
    raw = _module(
        "com/example/Caller.java",
        [RawImport(module="java.util", name="*", asname=None, level=0, lineno=1)],
    )

    result = resolve_imports("com/example/Caller.java", raw, {}, {})

    assert result.edges == [
        Edge(
            source="com/example/Caller.java",
            target="external::java.util.*",
            kind=EdgeKind.IMPORTS,
            external=True,
            ambiguous=True,
        )
    ]
    assert result.bindings == {}


def test_static_import_resolves_to_a_method_binding():
    module_by_dotted = {"com.example.util.Formatter": "com/example/util/Formatter.java"}
    modules = {
        "com/example/util/Formatter.java": _index(
            "com/example/util/Formatter.java",
            methods={("Formatter", "format"): "com/example/util/Formatter.java::Formatter.format"},
        )
    }
    raw = _module(
        "com/example/Caller.java",
        [
            RawImport(
                module="com.example.util.Formatter", name="format", asname=None, level=1, lineno=1
            )
        ],
    )

    result = resolve_imports("com/example/Caller.java", raw, module_by_dotted, modules)

    assert result.bindings["format"] == ImportBinding(
        local_name="format",
        dotted_prefix=None,
        symbol_id="com/example/util/Formatter.java::Formatter.format",
        external=False,
        ambiguous=False,
    )


def test_static_import_of_unknown_member_is_ambiguous_not_a_guess():
    module_by_dotted = {"com.example.util.Formatter": "com/example/util/Formatter.java"}
    modules = {"com/example/util/Formatter.java": _index("com/example/util/Formatter.java")}
    raw = _module(
        "com/example/Caller.java",
        [
            RawImport(
                module="com.example.util.Formatter", name="FIELD", asname=None, level=1, lineno=1
            )
        ],
    )

    result = resolve_imports("com/example/Caller.java", raw, module_by_dotted, modules)

    assert result.edges[0].ambiguous is True
    assert result.bindings["FIELD"].ambiguous is True
    assert result.bindings["FIELD"].symbol_id is None


def test_static_wildcard_import_of_local_class_is_ambiguous():
    module_by_dotted = {"com.example.util.Formatter": "com/example/util/Formatter.java"}
    modules = {"com/example/util/Formatter.java": _index("com/example/util/Formatter.java")}
    raw = _module(
        "com/example/Caller.java",
        [
            RawImport(
                module="com.example.util.Formatter", name="*", asname=None, level=1, lineno=1
            )
        ],
    )

    result = resolve_imports("com/example/Caller.java", raw, module_by_dotted, modules)

    assert result.edges == [
        Edge(
            source="com/example/Caller.java",
            target="com/example/util/Formatter.java",
            kind=EdgeKind.IMPORTS,
            ambiguous=True,
        )
    ]
    assert result.bindings == {}


def test_static_import_of_unresolvable_class_falls_back_external():
    raw = _module(
        "com/example/Caller.java",
        [RawImport(module="com.example.Unknown", name="thing", asname=None, level=1, lineno=1)],
    )

    result = resolve_imports("com/example/Caller.java", raw, {}, {})

    assert result.edges == [
        Edge(
            source="com/example/Caller.java",
            target="external::com.example.Unknown.thing",
            kind=EdgeKind.IMPORTS,
            external=True,
        )
    ]
    assert result.bindings["thing"].external is True
