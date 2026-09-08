from pathlib import Path

from semantic_vision.analysis.dead_code import find_dead_code_candidates
from semantic_vision.models import EdgeKind, Node, NodeKind


def _func(node_id: str, label: str, file: str = "app.py", **kwargs) -> Node:
    return Node(
        id=node_id,
        kind=NodeKind.FUNCTION,
        label=label,
        file=file,
        line_start=1,
        line_end=2,
        **kwargs,
    )


def test_zero_caller_function_is_flagged():
    nodes = [_func("app.py::orphan", "orphan")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert [c.node_id for c in candidates] == ["app.py::orphan"]


def test_function_with_a_real_caller_is_not_flagged():
    nodes = [_func("app.py::used", "used")]
    reverse_index = {"app.py::used": [("app.py::caller", EdgeKind.CALLS)]}
    candidates = find_dead_code_candidates(nodes, reverse_index, root=Path("."))
    assert candidates == []


def test_non_function_nodes_are_never_flagged():
    nodes = [
        Node(
            id="app.py",
            kind=NodeKind.FILE,
            label="app.py",
            file="app.py",
            line_start=1,
            line_end=10,
        ),
        Node(
            id="app.py::Widget",
            kind=NodeKind.CLASS,
            label="Widget",
            file="app.py",
            line_start=1,
            line_end=10,
        ),
    ]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_decorated_function_is_excluded():
    nodes = [_func("app.py::handler", "handler", has_decorators=True)]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_dunder_method_is_excluded():
    nodes = [_func("app.py::Widget.__init__", "__init__")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_main_entry_point_is_excluded_case_insensitively():
    nodes = [_func("app.py::Main", "Main")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_pytest_style_test_function_name_is_excluded():
    nodes = [_func("app.py::test_foo", "test_foo")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_function_defined_in_a_test_file_is_excluded_regardless_of_name():
    nodes = [_func("tests/test_app.py::helper", "helper", file="tests/test_app.py")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_function_under_a_tests_directory_is_excluded():
    nodes = [_func("pkg/tests/util.py::helper", "helper", file="pkg/tests/util.py")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_js_spec_file_is_excluded():
    nodes = [_func("app.spec.ts::helper", "helper", file="app.spec.ts")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_java_test_suffixed_file_is_excluded():
    nodes = [_func("com/pkg/FooTest.java::helper", "helper", file="com/pkg/FooTest.java")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_java_test_prefixed_file_is_excluded():
    nodes = [_func("com/pkg/TestFoo.java::helper", "helper", file="com/pkg/TestFoo.java")]
    candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
    assert candidates == []


def test_java_filename_merely_containing_test_is_not_excluded():
    # Regression: a case-insensitive "contains 'test'" check previously
    # flagged any of these as test files -- none actually is one.
    for filename in ("Latest.java", "Contest.java", "Fastest.java", "Testimonials.java"):
        nodes = [_func(f"{filename}::helper", "helper", file=filename)]
        candidates = find_dead_code_candidates(nodes, {}, root=Path("."))
        assert [c.node_id for c in candidates] == [f"{filename}::helper"], filename


def test_function_listed_in_module_all_is_excluded(tmp_path: Path):
    (tmp_path / "lib.py").write_text('__all__ = ["public_api"]\n\ndef public_api():\n    pass\n')
    nodes = [_func("lib.py::public_api", "public_api", file="lib.py")]
    candidates = find_dead_code_candidates(nodes, {}, root=tmp_path)
    assert candidates == []


def test_function_not_listed_in_module_all_is_still_flagged(tmp_path: Path):
    (tmp_path / "lib.py").write_text(
        '__all__ = ["public_api"]\n\ndef public_api():\n    pass\n\ndef _private():\n    pass\n'
    )
    nodes = [_func("lib.py::_private", "_private", file="lib.py")]
    candidates = find_dead_code_candidates(nodes, {}, root=tmp_path)
    assert [c.node_id for c in candidates] == ["lib.py::_private"]


def test_module_all_with_trailing_comment_recovers_every_name(tmp_path: Path):
    # Regression: a regex-based scanner that stopped at the first `]` (a
    # non-greedy match) truncated right at the `]` inside this comment,
    # silently dropping "b" from the recovered export set -- which would
    # have left `b` unprotected and wrongly flagged as dead code.
    (tmp_path / "lib.py").write_text(
        "__all__ = [\n"
        '    "a",  # see foo[bar] for details\n'
        '    "b",\n'
        "]\n\n"
        "def a():\n    pass\n\n"
        "def b():\n    pass\n"
    )
    nodes = [
        _func("lib.py::a", "a", file="lib.py"),
        _func("lib.py::b", "b", file="lib.py"),
    ]
    candidates = find_dead_code_candidates(nodes, {}, root=tmp_path)
    assert candidates == []


def test_module_all_as_tuple_is_recognized(tmp_path: Path):
    (tmp_path / "lib.py").write_text(
        '__all__ = ("a", "b")\n\ndef a():\n    pass\n\ndef b():\n    pass\n'
    )
    nodes = [
        _func("lib.py::a", "a", file="lib.py"),
        _func("lib.py::b", "b", file="lib.py"),
    ]
    candidates = find_dead_code_candidates(nodes, {}, root=tmp_path)
    assert candidates == []


def test_module_all_with_syntax_error_does_not_crash(tmp_path: Path):
    (tmp_path / "lib.py").write_text("def broken(:\n    pass\n")
    nodes = [_func("lib.py::broken", "broken", file="lib.py")]
    candidates = find_dead_code_candidates(nodes, {}, root=tmp_path)
    assert [c.node_id for c in candidates] == ["lib.py::broken"]


def test_missing_source_file_does_not_crash_all_scan(tmp_path: Path):
    nodes = [_func("missing.py::orphan", "orphan", file="missing.py")]
    candidates = find_dead_code_candidates(nodes, {}, root=tmp_path)
    assert [c.node_id for c in candidates] == ["missing.py::orphan"]
