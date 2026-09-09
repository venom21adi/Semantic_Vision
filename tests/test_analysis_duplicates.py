from pathlib import Path

from semantic_vision.analysis.duplicates import build_duplicate_groups
from semantic_vision.repo_parser import parse_repository


def _parse(tmp_path: Path, filename: str, source: str):
    (tmp_path / filename).write_text(source, encoding="utf-8")
    return parse_repository(str(tmp_path))


def test_structurally_identical_functions_are_grouped(tmp_path: Path):
    source = (
        "def add_and_double(a, b):\n"
        "    total = a + b\n"
        "    doubled = total * 2\n"
        "    return doubled\n"
        "\n"
        "\n"
        "def sum_and_scale(x, y):\n"
        "    result = x + y\n"
        "    scaled = result * 2\n"
        "    return scaled\n"
    )
    result = _parse(tmp_path, "app.py", source)

    groups = build_duplicate_groups(result)

    assert len(groups) == 1
    assert groups[0].size == 2
    assert set(groups[0].node_ids) == {"app.py::add_and_double", "app.py::sum_and_scale"}


def test_structurally_different_functions_are_not_grouped(tmp_path: Path):
    source = (
        "def add_and_double(a, b):\n"
        "    total = a + b\n"
        "    doubled = total * 2\n"
        "    return doubled\n"
        "\n"
        "\n"
        "def check(a, b):\n"
        "    if a > b:\n"
        "        return a\n"
        "    return b\n"
    )
    result = _parse(tmp_path, "app.py", source)

    groups = build_duplicate_groups(result)

    assert groups == []


def test_trivial_functions_are_excluded_by_the_minimum_size_threshold(tmp_path: Path):
    source = (
        "def noop_one():\n"
        "    pass\n"
        "\n"
        "\n"
        "def noop_two():\n"
        "    pass\n"
    )
    result = _parse(tmp_path, "app.py", source)

    groups = build_duplicate_groups(result)

    assert groups == []


def test_groups_are_sorted_by_size_descending(tmp_path: Path):
    source = (
        "def add_and_double(a, b):\n"
        "    total = a + b\n"
        "    doubled = total * 2\n"
        "    return doubled\n"
        "\n"
        "\n"
        "def sum_and_scale(x, y):\n"
        "    result = x + y\n"
        "    scaled = result * 2\n"
        "    return scaled\n"
        "\n"
        "\n"
        "def combine_and_double(p, q):\n"
        "    merged = p + q\n"
        "    twice = merged * 2\n"
        "    return twice\n"
        "\n"
        "\n"
        "def check(a, b):\n"
        "    if a > b:\n"
        "        return a\n"
        "    return b\n"
        "\n"
        "\n"
        "def compare(x, y):\n"
        "    if x > y:\n"
        "        return x\n"
        "    return y\n"
    )
    result = _parse(tmp_path, "app.py", source)

    groups = build_duplicate_groups(result)

    assert [g.size for g in groups] == [3, 2]


def test_python_single_expression_functions_are_not_excluded_as_trivial(tmp_path: Path):
    """A one-line `return`-expression function is a real, common duplication
    shape (delegation/accessor-style helpers) -- it must clear the minimum
    size threshold, unlike a bare `def __init__(self): pass`."""
    source = (
        "def get_x(a, b):\n"
        "    return a + b\n"
        "\n"
        "\n"
        "def get_y(x, y):\n"
        "    return x + y\n"
    )
    result = _parse(tmp_path, "app.py", source)

    groups = build_duplicate_groups(result)

    assert len(groups) == 1
    assert set(groups[0].node_ids) == {"app.py::get_x", "app.py::get_y"}


def test_javascript_comment_in_only_one_copy_does_not_prevent_grouping(tmp_path: Path):
    """A comment is not part of a function's structural shape -- two
    functions differing only by a comment (added, removed, or reworded in
    one copy) must still be recognized as duplicates. Also confirms a
    trivial JS stub (`noop`) stays excluded by the size threshold."""
    (tmp_path / "app.js").write_text(
        "function noop() {}\n\n"
        "function addAndDouble(a, b) {\n"
        "    // running total before doubling\n"
        "    const total = a + b;\n"
        "    return total * 2;\n"
        "}\n\n"
        "function sumAndScale(x, y) {\n"
        "    const result = x + y;\n"
        "    return result * 2;\n"
        "}\n",
        encoding="utf-8",
    )
    result = parse_repository(str(tmp_path), language="javascript")

    groups = build_duplicate_groups(result)

    assert len(groups) == 1
    assert set(groups[0].node_ids) == {"app.js::addAndDouble", "app.js::sumAndScale"}


def test_java_comment_in_only_one_copy_does_not_prevent_grouping(tmp_path: Path):
    (tmp_path / "Foo.java").write_text(
        "class Foo {\n"
        "    void noop() {}\n\n"
        "    int addAndDouble(int a, int b) {\n"
        "        // running total before doubling\n"
        "        int total = a + b;\n"
        "        return total * 2;\n"
        "    }\n\n"
        "    int sumAndScale(int x, int y) {\n"
        "        int result = x + y;\n"
        "        return result * 2;\n"
        "    }\n"
        "}\n",
        encoding="utf-8",
    )
    result = parse_repository(str(tmp_path), language="java")

    groups = build_duplicate_groups(result)

    assert len(groups) == 1
    assert set(groups[0].node_ids) == {
        "Foo.java::Foo.addAndDouble",
        "Foo.java::Foo.sumAndScale",
    }


def test_duplicate_detection_works_across_files(tmp_path: Path):
    (tmp_path / "a.py").write_text(
        "def add_and_double(a, b):\n"
        "    total = a + b\n"
        "    doubled = total * 2\n"
        "    return doubled\n",
        encoding="utf-8",
    )
    (tmp_path / "b.py").write_text(
        "def sum_and_scale(x, y):\n"
        "    result = x + y\n"
        "    scaled = result * 2\n"
        "    return scaled\n",
        encoding="utf-8",
    )
    result = parse_repository(str(tmp_path))

    groups = build_duplicate_groups(result)

    assert len(groups) == 1
    assert set(groups[0].node_ids) == {"a.py::add_and_double", "b.py::sum_and_scale"}
