from semantic_vision.analysis.complexity import ComplexityScore
from semantic_vision.analysis.coverage import build_coverage_risk_scores
from semantic_vision.models import EdgeKind, Node, NodeKind


def _func(node_id: str, file: str, line_start: int, line_end: int) -> Node:
    return Node(
        id=node_id,
        kind=NodeKind.FUNCTION,
        label=node_id.rsplit("::", 1)[-1],
        file=file,
        line_start=line_start,
        line_end=line_end,
    )


def _complexity(node_id: str, complexity: int) -> ComplexityScore:
    return ComplexityScore(
        node_id=node_id,
        cyclomatic_complexity=complexity,
        call_chain_depth=0,
        has_nested_loops=False,
    )


def test_fully_covered_function_has_zero_risk_from_coverage_term():
    nodes = [_func("app.py::f", "app.py", 2, 4)]
    complexity_index = {"app.py::f": _complexity("app.py::f", 3)}
    line_hits = {"app.py": {2: 1, 3: 1, 4: 1}}

    scores = build_coverage_risk_scores(nodes, complexity_index, {}, line_hits)

    assert scores[0].coverage_ratio == 1.0
    assert scores[0].risk_score == 0.0


def test_uncovered_function_ranks_by_complexity_and_blast_radius():
    nodes = [_func("app.py::f", "app.py", 2, 3)]
    complexity_index = {"app.py::f": _complexity("app.py::f", 4)}
    line_hits = {"app.py": {2: 0, 3: 0}}
    reverse_index = {"app.py::f": [("app.py::caller", EdgeKind.CALLS)]}

    scores = build_coverage_risk_scores(nodes, complexity_index, reverse_index, line_hits)

    assert scores[0].coverage_ratio == 0.0
    assert scores[0].blast_radius == 1
    assert scores[0].risk_score == 4 * (1 + 1) * 1


def test_function_with_no_coverage_data_for_its_file_is_none_not_zero():
    nodes = [_func("app.py::f", "app.py", 1, 2)]
    complexity_index = {"app.py::f": _complexity("app.py::f", 2)}

    scores = build_coverage_risk_scores(nodes, complexity_index, {}, {})

    assert scores[0].coverage_ratio is None
    # Missing data is treated as worst-case (0.0 coverage) for ranking purposes.
    assert scores[0].risk_score == 2 * 1 * 1


def test_missing_complexity_entry_defaults_to_one():
    nodes = [_func("app.py::f", "app.py", 1, 1)]

    scores = build_coverage_risk_scores(nodes, {}, {}, {})

    assert scores[0].cyclomatic_complexity == 1


def test_non_function_nodes_are_skipped():
    nodes = [
        Node(
            id="app.py",
            kind=NodeKind.FILE,
            label="app.py",
            file="app.py",
            line_start=1,
            line_end=10,
        ),
    ]

    scores = build_coverage_risk_scores(nodes, {}, {}, {})

    assert scores == []


def test_sorted_by_risk_score_descending():
    nodes = [
        _func("app.py::low", "app.py", 1, 1),
        _func("app.py::high", "app.py", 2, 2),
    ]
    complexity_index = {
        "app.py::low": _complexity("app.py::low", 1),
        "app.py::high": _complexity("app.py::high", 9),
    }

    scores = build_coverage_risk_scores(nodes, complexity_index, {}, {})

    assert [s.node_id for s in scores] == ["app.py::high", "app.py::low"]


def test_lines_outside_function_range_are_not_counted():
    nodes = [_func("app.py::f", "app.py", 5, 6)]
    complexity_index = {"app.py::f": _complexity("app.py::f", 1)}
    line_hits = {"app.py": {1: 0, 5: 1, 6: 1, 20: 0}}

    scores = build_coverage_risk_scores(nodes, complexity_index, {}, line_hits)

    assert scores[0].coverage_ratio == 1.0
