from pathlib import Path

from semantic_vision.models import Node, NodeKind
from semantic_vision.ts_locate import locate


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
    (tmp_path / "a.ts").write_text(source, encoding="utf-8")
    return tmp_path


SOURCE = """function greet(name: string): string {
  return name;
}

class Greeter {
  greet(name: string): string {
    return name;
  }
}

const arrow = (x: number): number => x * 2;

class C {
  field = (x: number) => x + 1;
}
"""


def test_locate_finds_a_function_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "a.ts", 1), {}, {})

    assert found is not None
    assert found.type == "function_declaration"


def test_locate_finds_a_class_declaration(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("Greeter", "a.ts", 5), {}, {})

    assert found is not None
    assert found.type == "class_declaration"


def test_locate_finds_a_method_definition(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "a.ts", 6), {}, {})

    assert found is not None
    assert found.type == "method_definition"


def test_locate_finds_a_declarator_bound_arrow_function(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("arrow", "a.ts", 11), {}, {})

    assert found is not None
    assert found.type == "arrow_function"


def test_locate_finds_a_field_bound_arrow_function(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("field", "a.ts", 14), {}, {})

    assert found is not None
    assert found.type == "arrow_function"


def test_locate_returns_none_for_a_line_mismatch(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("greet", "a.ts", 99), {}, {})

    assert found is None


def test_locate_returns_none_for_a_name_mismatch(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    found = locate(root, _node("notGreet", "a.ts", 1), {}, {})

    assert found is None


def test_locate_returns_none_for_a_missing_file(tmp_path: Path):
    found = locate(tmp_path, _node("greet", "missing.ts", 1), {}, {})

    assert found is None


def test_locate_caches_the_tree_and_the_index_across_calls(tmp_path: Path):
    root = _write(tmp_path, SOURCE)
    trees: dict = {}
    indices: dict = {}
    locate(root, _node("greet", "a.ts", 1), trees, indices)
    cached_tree = trees["a.ts"]
    cached_index = indices["a.ts"]

    locate(root, _node("Greeter", "a.ts", 5), trees, indices)

    assert trees["a.ts"] is cached_tree
    assert indices["a.ts"] is cached_index


def test_locate_via_a_fresh_index_matches_locate_via_a_reused_index(tmp_path: Path):
    """The index-based lookup (built once per file) must return the exact
    same node a from-scratch lookup would -- this is the direct regression
    check that indexing didn't change *which* node gets found, only how
    cheaply repeated lookups in the same file are."""
    root = _write(tmp_path, SOURCE)

    fresh_trees: dict = {}
    fresh_indices: dict = {}
    first = locate(root, _node("greet", "a.ts", 6), fresh_trees, fresh_indices)

    shared_trees: dict = {}
    shared_indices: dict = {}
    # Prime the cache with an unrelated lookup in the same file first, so
    # the second call below is served entirely from the cached index.
    locate(root, _node("greet", "a.ts", 1), shared_trees, shared_indices)
    second = locate(root, _node("greet", "a.ts", 6), shared_trees, shared_indices)

    assert first is not None
    assert second is not None
    assert first.type == second.type == "method_definition"
    assert first.start_point == second.start_point
