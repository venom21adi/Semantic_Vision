from pathlib import Path

from semantic_vision.ast_locate import locate
from semantic_vision.models import Node, NodeKind


def _node(label: str, file: str, line: int) -> Node:
    return Node(
        id=f"{file}::{label}",
        kind=NodeKind.FUNCTION,
        label=label,
        file=file,
        line_start=line,
        line_end=line,
    )


def _write(tmp_path: Path, source: str) -> Path:
    (tmp_path / "a.py").write_text(source, encoding="utf-8")
    return tmp_path


SOURCE = """def greet(name):
    return name


class Greeter:
    def greet(self, name):
        return name

    class Nested:
        def inner(self):
            return 1
"""


def test_locate_finds_a_top_level_function(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "a.py", 1), {}, {})

    assert found is not None
    assert found.name == "greet"


def test_locate_finds_a_class(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("Greeter", "a.py", 5), {}, {})

    assert found is not None
    assert found.name == "Greeter"


def test_locate_finds_a_method(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "a.py", 6), {}, {})

    assert found is not None
    assert found.name == "greet"
    assert found.lineno == 6


def test_locate_finds_a_nested_class_and_its_method(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    nested_class = locate(root, _node("Nested", "a.py", 9), {}, {})
    nested_method = locate(root, _node("inner", "a.py", 10), {}, {})

    assert nested_class is not None
    assert nested_class.name == "Nested"
    assert nested_method is not None
    assert nested_method.name == "inner"


def test_locate_returns_none_for_a_line_mismatch(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "a.py", 99), {}, {})

    assert found is None


def test_locate_returns_none_for_a_name_mismatch(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("notGreet", "a.py", 1), {}, {})

    assert found is None


def test_locate_returns_none_for_a_missing_file(tmp_path: Path):
    found = locate(tmp_path, _node("greet", "missing.py", 1), {}, {})

    assert found is None


def test_locate_returns_none_for_a_syntax_error(tmp_path: Path):
    root = _write(tmp_path, "def greet(:\n")
    found = locate(root, _node("greet", "a.py", 1), {}, {})

    assert found is None


def test_locate_caches_the_tree_and_the_index_across_calls(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    trees: dict = {}
    indices: dict = {}
    locate(root, _node("greet", "a.py", 1), trees, indices)
    cached_tree = trees["a.py"]
    cached_index = indices["a.py"]

    locate(root, _node("Greeter", "a.py", 5), trees, indices)

    assert trees["a.py"] is cached_tree
    assert indices["a.py"] is cached_index


def test_locate_via_a_fresh_index_matches_locate_via_a_reused_index(tmp_path: Path):
    """The index-based lookup (built once per file) must return the exact
    same node a from-scratch lookup would -- this is the direct regression
    check that indexing didn't change *which* node gets found, only how
    cheaply repeated lookups in the same file are."""
    root = _write(tmp_path, SOURCE)

    fresh_trees: dict = {}
    fresh_indices: dict = {}
    first = locate(root, _node("greet", "a.py", 6), fresh_trees, fresh_indices)

    shared_trees: dict = {}
    shared_indices: dict = {}
    # Prime the cache with an unrelated lookup in the same file first, so
    # the second call below is served entirely from the cached index.
    locate(root, _node("greet", "a.py", 1), shared_trees, shared_indices)
    second = locate(root, _node("greet", "a.py", 6), shared_trees, shared_indices)

    assert first is not None
    assert second is not None
    assert first.name == second.name == "greet"
    assert first.lineno == second.lineno == 6
