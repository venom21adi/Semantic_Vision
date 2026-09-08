from pathlib import Path

from semantic_vision.analysis.complexity import ComplexityScore
from semantic_vision.analysis.hotspots import build_hotspot_scores


def _score(node_id: str, complexity: int) -> ComplexityScore:
    return ComplexityScore(
        node_id=node_id,
        cyclomatic_complexity=complexity,
        call_chain_depth=0,
        has_nested_loops=False,
    )


def test_build_hotspot_scores_joins_by_file_when_offset_is_empty():
    complexity_index = {
        "app.py::f": _score("app.py::f", complexity=4),
        "app.py::g": _score("app.py::g", complexity=2),
    }
    churn_by_file = {"app.py": 3}

    scores = build_hotspot_scores(complexity_index, churn_by_file, offset=Path("."))

    by_id = {s.node_id: s for s in scores}
    assert by_id["app.py::f"].change_count == 3
    assert by_id["app.py::f"].hotspot_score == 12
    assert by_id["app.py::g"].hotspot_score == 6


def test_build_hotspot_scores_joins_across_a_subdirectory_offset():
    # The exact node-id-misalignment scenario from the ref-diff slice: the
    # repo was parsed at `<git_root>/backend`, so node ids are relative to
    # `backend/`, but churn is relative to the git root.
    complexity_index = {"app.py::f": _score("app.py::f", complexity=5)}
    churn_by_file = {"backend/app.py": 7}

    scores = build_hotspot_scores(complexity_index, churn_by_file, offset=Path("backend"))

    assert scores[0].change_count == 7
    assert scores[0].hotspot_score == 35


def test_build_hotspot_scores_defaults_missing_churn_to_zero():
    complexity_index = {"app.py::f": _score("app.py::f", complexity=9)}

    scores = build_hotspot_scores(complexity_index, {}, offset=Path("."))

    assert scores[0].change_count == 0
    assert scores[0].hotspot_score == 0


def test_build_hotspot_scores_sorts_descending_by_hotspot_score():
    complexity_index = {
        "app.py::low": _score("app.py::low", complexity=2),
        "app.py::high": _score("app.py::high", complexity=10),
    }
    churn_by_file = {"app.py": 4}

    scores = build_hotspot_scores(complexity_index, churn_by_file, offset=Path("."))

    assert [s.node_id for s in scores] == ["app.py::high", "app.py::low"]
