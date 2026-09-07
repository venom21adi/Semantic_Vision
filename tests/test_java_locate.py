from pathlib import Path

from semantic_vision.java_locate import locate
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
    (tmp_path / "A.java").write_text(source, encoding="utf-8")
    return tmp_path


SOURCE = """class A {
  A() {
  }

  void greet(String name) {
  }
}

interface Shape {
  double area();
}

enum Status {
  OK, FAIL;

  boolean isOk() { return this == OK; }
}
"""


def test_locate_finds_a_method_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "A.java", 5), {}, {})

    assert found is not None
    assert found.type == "method_declaration"


def test_locate_finds_a_constructor_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("A", "A.java", 2), {}, {})

    assert found is not None
    assert found.type == "constructor_declaration"


def test_locate_finds_a_class_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("A", "A.java", 1), {}, {})

    assert found is not None
    assert found.type == "class_declaration"


def test_locate_finds_an_interface_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("Shape", "A.java", 9), {}, {})

    assert found is not None
    assert found.type == "interface_declaration"


def test_locate_finds_an_enum_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("Status", "A.java", 13), {}, {})

    assert found is not None
    assert found.type == "enum_declaration"


def test_locate_finds_a_method_declared_after_the_enum_constants(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("isOk", "A.java", 16), {}, {})

    assert found is not None
    assert found.type == "method_declaration"


def test_locate_returns_none_for_a_line_mismatch(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "A.java", 99), {}, {})

    assert found is None


def test_locate_returns_none_for_a_name_mismatch(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("notGreet", "A.java", 5), {}, {})

    assert found is None


def test_locate_returns_none_for_a_missing_file(tmp_path: Path):
    found = locate(tmp_path, _node("greet", "Missing.java", 1), {}, {})

    assert found is None


def test_locate_caches_the_tree_and_the_index_across_calls(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    trees: dict = {}
    indices: dict = {}
    locate(root, _node("greet", "A.java", 5), trees, indices)
    cached_tree = trees["A.java"]
    cached_index = indices["A.java"]

    locate(root, _node("A", "A.java", 1), trees, indices)

    assert trees["A.java"] is cached_tree
    assert indices["A.java"] is cached_index


def test_locate_via_a_fresh_index_matches_locate_via_a_reused_index(tmp_path: Path):
    root = _write(tmp_path, SOURCE)

    fresh_trees: dict = {}
    fresh_indices: dict = {}
    first = locate(root, _node("greet", "A.java", 5), fresh_trees, fresh_indices)

    shared_trees: dict = {}
    shared_indices: dict = {}
    locate(root, _node("A", "A.java", 1), shared_trees, shared_indices)
    second = locate(root, _node("greet", "A.java", 5), shared_trees, shared_indices)

    assert first is not None
    assert second is not None
    assert first.type == second.type == "method_declaration"
    assert first.start_point == second.start_point
