from pathlib import Path

import pytest

from semantic_vision.models import Edge, EdgeKind, Node, NodeKind
from semantic_vision.repo_parser import parse_repository

FIXTURES = Path(__file__).parent / "fixtures"


def test_simple_repo_symbols_and_edges_match_exactly():
    """The cheapest success check from the build plan's first slice: one
    module, one class method, one imported function, one unresolved
    (external) call -- exact symbol and edge assertions."""
    result = parse_repository(FIXTURES / "simple_repo")

    assert result.root == (FIXTURES / "simple_repo").resolve().as_posix()
    assert result.parse_errors == []
    assert result.variables == []

    expected_nodes = [
        Node(
            id="app.py", kind=NodeKind.FILE, label="app.py", file="app.py", line_start=1, line_end=8
        ),
        Node(
            id="app.py::Greeter",
            kind=NodeKind.CLASS,
            label="Greeter",
            file="app.py",
            line_start=5,
            line_end=8,
        ),
        Node(
            id="app.py::Greeter.greet",
            kind=NodeKind.FUNCTION,
            label="greet",
            file="app.py",
            line_start=6,
            line_end=8,
        ),
        Node(
            id="helpers.py",
            kind=NodeKind.FILE,
            label="helpers.py",
            file="helpers.py",
            line_start=1,
            line_end=2,
        ),
        Node(
            id="helpers.py::format_name",
            kind=NodeKind.FUNCTION,
            label="format_name",
            file="helpers.py",
            line_start=1,
            line_end=2,
        ),
    ]
    assert result.nodes == expected_nodes

    expected_edges = [
        Edge(source="app.py", target="app.py::Greeter", kind=EdgeKind.DEFINES),
        Edge(source="app.py", target="external::os", kind=EdgeKind.IMPORTS, external=True),
        Edge(source="app.py", target="helpers.py::format_name", kind=EdgeKind.IMPORTS),
        Edge(source="app.py::Greeter", target="app.py::Greeter.greet", kind=EdgeKind.DEFINES),
        Edge(
            source="app.py::Greeter.greet",
            target="external::os.path.join",
            kind=EdgeKind.CALLS,
            external=True,
        ),
        Edge(
            source="app.py::Greeter.greet",
            target="helpers.py::format_name",
            kind=EdgeKind.CALLS,
        ),
        Edge(source="helpers.py", target="helpers.py::format_name", kind=EdgeKind.DEFINES),
    ]
    assert result.edges == expected_edges


def test_syntax_error_does_not_abort_repo_parse():
    result = parse_repository(FIXTURES / "broken_repo")

    assert [e.file for e in result.parse_errors] == ["bad.py"]
    assert result.parse_errors[0].line is not None

    ok_node = next(n for n in result.nodes if n.id == "good.py::ok")
    assert ok_node.kind == NodeKind.FUNCTION

    file_ids = {n.id for n in result.nodes if n.kind == NodeKind.FILE}
    assert file_ids == {"good.py", "bad.py"}


def test_circular_imports_resolve_without_crashing():
    result = parse_repository(FIXTURES / "circular_repo")

    assert result.parse_errors == []
    calls = {(e.source, e.target) for e in result.edges if e.kind == EdgeKind.CALLS}
    assert ("a.py::func_a", "b.py::func_b") in calls
    assert ("b.py::func_b", "a.py::func_a") not in calls  # func_b doesn't call func_a

    imports_edges = [e for e in result.edges if e.kind == EdgeKind.IMPORTS]
    assert all(not e.ambiguous and not e.external for e in imports_edges)


def test_javascript_repo_symbols_and_edges_match_exactly():
    """The JS/TS counterpart to `test_simple_repo_symbols_and_edges_match_exactly`:
    a relative import resolving to a real symbol, a bare/external namespace
    import, and a `this.method()` call -- exact node/edge assertions."""
    result = parse_repository(FIXTURES / "js_repo", language="javascript")

    assert result.root == (FIXTURES / "js_repo").resolve().as_posix()
    assert result.parse_errors == []
    assert result.variables == []

    expected_nodes = [
        Node(id="src", kind=NodeKind.DIRECTORY, label="src", file="src", line_start=0, line_end=0),
        Node(
            id="src/greeter.ts",
            kind=NodeKind.FILE,
            label="greeter.ts",
            file="src/greeter.ts",
            line_start=1,
            line_end=13,
        ),
        Node(
            id="src/greeter.ts::Greeter",
            kind=NodeKind.CLASS,
            label="Greeter",
            file="src/greeter.ts",
            line_start=4,
            line_end=13,
        ),
        Node(
            id="src/greeter.ts::Greeter.clean",
            kind=NodeKind.FUNCTION,
            label="clean",
            file="src/greeter.ts",
            line_start=10,
            line_end=12,
        ),
        Node(
            id="src/greeter.ts::Greeter.greet",
            kind=NodeKind.FUNCTION,
            label="greet",
            file="src/greeter.ts",
            line_start=5,
            line_end=8,
        ),
        Node(
            id="src/helper.ts",
            kind=NodeKind.FILE,
            label="helper.ts",
            file="src/helper.ts",
            line_start=1,
            line_end=3,
        ),
        Node(
            id="src/helper.ts::formatName",
            kind=NodeKind.FUNCTION,
            label="formatName",
            file="src/helper.ts",
            line_start=1,
            line_end=3,
        ),
    ]
    assert result.nodes == expected_nodes

    expected_edges = [
        Edge(source="src", target="src/greeter.ts", kind=EdgeKind.DEFINES),
        Edge(source="src", target="src/helper.ts", kind=EdgeKind.DEFINES),
        Edge(
            source="src/greeter.ts", target="external::path", kind=EdgeKind.IMPORTS, external=True
        ),
        Edge(source="src/greeter.ts", target="src/greeter.ts::Greeter", kind=EdgeKind.DEFINES),
        Edge(
            source="src/greeter.ts",
            target="src/helper.ts::formatName",
            kind=EdgeKind.IMPORTS,
        ),
        Edge(
            source="src/greeter.ts::Greeter",
            target="src/greeter.ts::Greeter.clean",
            kind=EdgeKind.DEFINES,
        ),
        Edge(
            source="src/greeter.ts::Greeter",
            target="src/greeter.ts::Greeter.greet",
            kind=EdgeKind.DEFINES,
        ),
        Edge(
            source="src/greeter.ts::Greeter.clean",
            target="src/helper.ts::formatName",
            kind=EdgeKind.CALLS,
        ),
        Edge(
            source="src/greeter.ts::Greeter.greet",
            target="external::path.join",
            kind=EdgeKind.CALLS,
            external=True,
        ),
        Edge(
            source="src/greeter.ts::Greeter.greet",
            target="src/greeter.ts::Greeter.clean",
            kind=EdgeKind.CALLS,
        ),
        Edge(source="src/helper.ts", target="src/helper.ts::formatName", kind=EdgeKind.DEFINES),
    ]
    assert result.edges == expected_edges


def test_star_import_and_unresolved_call_are_ambiguous():
    result = parse_repository(FIXTURES / "star_repo")

    star_import = next(e for e in result.edges if e.kind == EdgeKind.IMPORTS)
    assert star_import.source == "main.py"
    assert star_import.target == "constants.py"
    assert star_import.ambiguous is True

    call_edge = next(e for e in result.edges if e.kind == EdgeKind.CALLS)
    assert call_edge.source == "main.py::use"
    assert call_edge.target == "unresolved::unknown_thing"
    assert call_edge.ambiguous is True
    assert call_edge.external is False


def test_nested_packages_produce_directory_nodes_and_resolve_dotted_imports():
    result = parse_repository(FIXTURES / "nested_repo")

    dir_nodes = {n.id: n for n in result.nodes if n.kind == NodeKind.DIRECTORY}
    assert set(dir_nodes) == {"pkg", "pkg/sub"}
    assert dir_nodes["pkg"].label == "pkg"
    assert dir_nodes["pkg/sub"].label == "sub"

    defines = {(e.source, e.target) for e in result.edges if e.kind == EdgeKind.DEFINES}
    assert ("pkg", "pkg/sub") in defines
    assert ("pkg/sub", "pkg/sub/mod.py") in defines
    # main.py sits at the repo root, so it has no parent directory node.
    assert not any(target == "main.py" for _, target in defines)

    calls = [e for e in result.edges if e.kind == EdgeKind.CALLS]
    resolved = next(e for e in calls if e.source == "main.py::run")
    assert resolved.target == "pkg/sub/mod.py::deep"
    assert resolved.external is False
    assert resolved.ambiguous is False


def test_missing_directory_raises():
    with pytest.raises(NotADirectoryError):
        parse_repository(FIXTURES / "does_not_exist")


def test_unreadable_directory_raises():
    """Windows ACLs don't reliably honor POSIX-style chmod, so a real
    unreadable directory isn't a portable way to exercise this path --
    the `os.access` check itself is monkeypatched instead."""
    import semantic_vision.repo_parser as repo_parser_module

    original_access = repo_parser_module.os.access

    def denied(path, mode):
        if Path(path) == (FIXTURES / "simple_repo"):
            return False
        return original_access(path, mode)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(repo_parser_module.os, "access", denied)
        with pytest.raises(PermissionError):
            parse_repository(FIXTURES / "simple_repo")


def test_bare_relative_from_import_resolves_locally():
    """`from . import sibling` must resolve `sibling` to the sibling
    module in the same package, not be misread as an absolute top-level
    module named "sibling" and marked external."""
    result = parse_repository(FIXTURES / "relative_import_repo")

    import_edge = next(e for e in result.edges if e.kind == EdgeKind.IMPORTS)
    assert import_edge.source == "pkg/user.py"
    assert import_edge.target == "pkg/sibling.py"
    assert import_edge.external is False
    assert import_edge.ambiguous is False

    call_edge = next(e for e in result.edges if e.kind == EdgeKind.CALLS)
    assert call_edge.source == "pkg/user.py::run"
    assert call_edge.target == "pkg/sibling.py::hello"
    assert call_edge.external is False
    assert call_edge.ambiguous is False


def test_multi_level_dotted_import_call_resolves():
    """`import pkg.sub.mod` followed by `pkg.sub.mod.deep()` must walk
    the full attribute chain to the actual function, not just one hop."""
    result = parse_repository(FIXTURES / "dotted_import_repo")

    call_edge = next(e for e in result.edges if e.kind == EdgeKind.CALLS)
    assert call_edge.source == "main.py::run"
    assert call_edge.target == "pkg/sub/mod.py::deep"
    assert call_edge.external is False
    assert call_edge.ambiguous is False


def test_aliased_multi_level_dotted_import_call_resolves():
    """`import pkg.sub.mod as m` binds `m` directly to the leaf module,
    so `m.deep()` should resolve without needing the `pkg` root name."""
    result = parse_repository(FIXTURES / "aliased_dotted_import_repo")

    call_edge = next(e for e in result.edges if e.kind == EdgeKind.CALLS)
    assert call_edge.source == "main.py::run"
    assert call_edge.target == "pkg/sub/mod.py::deep"
    assert call_edge.external is False
    assert call_edge.ambiguous is False


def test_multi_level_relative_import_resolves():
    """`from .. import top` (two dots) must walk up an extra package
    level, not just the immediate containing package."""
    result = parse_repository(FIXTURES / "multi_level_relative_repo")

    import_edge = next(e for e in result.edges if e.kind == EdgeKind.IMPORTS)
    assert import_edge.source == "pkg/sub/__init__.py"
    assert import_edge.target == "pkg/__init__.py::top"
    assert import_edge.external is False
    assert import_edge.ambiguous is False

    call_edge = next(e for e in result.edges if e.kind == EdgeKind.CALLS)
    assert call_edge.source == "pkg/sub/__init__.py::use"
    assert call_edge.target == "pkg/__init__.py::top"


def test_nested_classes_are_not_silently_dropped():
    result = parse_repository(FIXTURES / "nested_class_repo")

    node_ids = {n.id for n in result.nodes}
    # Class nested inside another class.
    assert "app.py::Outer.Inner" in node_ids
    assert "app.py::Outer.Inner.method" in node_ids
    # Class nested inside a function body.
    assert "app.py::factory.Local" in node_ids
    assert "app.py::factory.Local.method" in node_ids

    defines = {(e.source, e.target) for e in result.edges if e.kind == EdgeKind.DEFINES}
    assert ("app.py::Outer", "app.py::Outer.Inner") in defines
    assert ("app.py::factory", "app.py::factory.Local") in defines


def test_nested_classes_wrapped_in_control_flow_are_not_dropped():
    """Classes (and functions) guarded by `if`/`for`/`try`/etc. still
    execute in the same Python scope as an unwrapped def -- they must be
    discovered the same way a direct nested def would be."""
    result = parse_repository(FIXTURES / "control_flow_repo")

    node_ids = {n.id for n in result.nodes}
    assert "app.py::make.Local" in node_ids
    assert "app.py::make.Local.method" in node_ids
    assert "app.py::Outer.Nested" in node_ids
    assert "app.py::ModuleLevelConditional" in node_ids


def test_class_nested_through_multiple_closures_is_not_dropped():
    """A class defined inside a closure, itself nested inside another
    closure, inside a named function (three scopes deep) must still be
    discovered -- nested function defs are flattened for call-tracking
    purposes, but that must never cause a class buried inside them to
    vanish with zero trace."""
    result = parse_repository(FIXTURES / "deep_closure_class_repo")

    node_ids = {n.id for n in result.nodes}
    assert "app.py::outer.Deep" in node_ids
    assert "app.py::outer.Deep.method" in node_ids

    defines = {(e.source, e.target) for e in result.edges if e.kind == EdgeKind.DEFINES}
    assert ("app.py::outer", "app.py::outer.Deep") in defines
    assert ("app.py::outer.Deep", "app.py::outer.Deep.method") in defines

    calls = [e for e in result.edges if e.kind == EdgeKind.CALLS]
    resolved = next(e for e in calls if e.source == "app.py::outer.Deep.method")
    assert resolved.target == "app.py::helper"
    assert resolved.external is False
    assert resolved.ambiguous is False


def test_class_decorator_call_is_attributed_to_enclosing_scope():
    result = parse_repository(FIXTURES / "class_decorator_repo")

    calls = [e for e in result.edges if e.kind == EdgeKind.CALLS]
    assert len(calls) == 1
    assert calls[0].source == "app.py"
    assert calls[0].target == "app.py::register"


def test_decorator_calls_are_attributed_to_enclosing_scope():
    """A decorator like `@route("/x")` evaluates at module-definition
    time, not inside the decorated function's body -- the call should be
    attributed to the file, not to `handler` itself."""
    result = parse_repository(FIXTURES / "decorator_repo")

    calls = [e for e in result.edges if e.kind == EdgeKind.CALLS]
    assert len(calls) == 1
    assert calls[0].source == "app.py"
    assert calls[0].target == "app.py::route"

    handler_calls = [e for e in calls if e.source == "app.py::handler"]
    assert handler_calls == []
