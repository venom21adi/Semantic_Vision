from semantic_vision.analysis.impact import (
    Caller,
    build_reverse_caller_index,
    find_upstream_callers,
)
from semantic_vision.models import Edge, EdgeKind


def edge(source: str, target: str) -> Edge:
    return Edge(source=source, target=target, kind=EdgeKind.CALLS)


def test_reverse_index_only_indexes_calls_edges():
    edges = [
        edge("a", "b"),
        Edge(source="a", target="b.py", kind=EdgeKind.IMPORTS),
        Edge(source="b.py", target="b", kind=EdgeKind.DEFINES),
    ]

    index = build_reverse_caller_index(edges)

    assert index == {"b": ["a"]}


def test_direct_callers_only_one_hop_away():
    edges = [edge("a", "target"), edge("b", "target")]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("target", index)

    assert result.target == "target"
    assert {c.id for c in result.callers} == {"a", "b"}
    assert all(c.depth == 1 and c.direct for c in result.callers)
    assert result.cycles == []


def test_multi_hop_callers_are_separated_from_direct_callers():
    # c -> b -> a -> target
    edges = [edge("a", "target"), edge("b", "a"), edge("c", "b")]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("target", index)

    by_id = {c.id: c for c in result.callers}
    assert by_id["a"] == Caller(id="a", depth=1, direct=True)
    assert by_id["b"] == Caller(id="b", depth=2, direct=False)
    assert by_id["c"] == Caller(id="c", depth=3, direct=False)
    assert {e.source for e in result.edges} == {"a", "b", "c"}


def test_no_callers_returns_empty_result():
    index = build_reverse_caller_index([edge("a", "b")])

    result = find_upstream_callers("target", index)

    assert result.callers == []
    assert result.edges == []
    assert result.cycles == []


def test_max_depth_cuts_off_transitive_callers():
    # c -> b -> a -> target, but max_depth=1 should only surface `a`.
    edges = [edge("a", "target"), edge("b", "a"), edge("c", "b")]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("target", index, max_depth=1)

    assert {c.id for c in result.callers} == {"a"}


def test_diamond_convergence_is_not_reported_as_a_cycle():
    # Two direct callers of target both trace back to the same node `c`
    # at depth 2 -- a legitimate converging path, not a circular chain.
    edges = [
        edge("a", "target"),
        edge("b", "target"),
        edge("c", "a"),
        edge("c", "b"),
    ]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("target", index)

    assert {c.id for c in result.callers} == {"a", "b", "c"}
    assert result.cycles == []


def test_cross_depth_diamond_is_not_reported_as_a_cycle():
    # A direct caller of target (`process`) that ALSO reaches target
    # indirectly through a second caller (`validate`) -- an everyday
    # shape (a caller invoking the target directly and via a shared
    # helper), not a circular call chain: process -> save, validate ->
    # save, process -> validate.
    edges = [edge("process", "save"), edge("validate", "save"), edge("process", "validate")]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("save", index)

    by_id = {c.id: c for c in result.callers}
    assert by_id["process"] == Caller(id="process", depth=1, direct=True)
    assert by_id["validate"] == Caller(id="validate", depth=1, direct=True)
    assert result.cycles == []


def test_direct_self_recursion_is_a_cycle_not_an_extra_caller():
    edges = [edge("target", "target")]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("target", index)

    assert result.callers == []
    assert result.cycles == [["target", "target"]]


def test_circular_call_chain_is_detected_without_infinite_looping():
    # target -> b -> a -> target (a circular call chain)
    edges = [edge("a", "target"), edge("b", "a"), edge("target", "b")]
    index = build_reverse_caller_index(edges)

    result = find_upstream_callers("target", index)

    assert {c.id for c in result.callers} == {"a", "b"}
    assert result.cycles == [["target", "b"]]
