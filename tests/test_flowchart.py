from pathlib import Path

from semantic_vision.flowchart.cfg import (
    FlowchartResult,
    FlowEdgeKind,
    FlowNodeKind,
    build_flowchart,
)
from semantic_vision.repo_parser import parse_repository

FIXTURES = Path(__file__).parent / "fixtures"


def _flowchart(node_id: str) -> FlowchartResult:
    result = parse_repository(str(FIXTURES / "flowchart_repo"))
    return build_flowchart(result, node_id)


def _nodes_of_kind(fc: FlowchartResult, kind: FlowNodeKind):
    return [n for n in fc.nodes if n.kind == kind]


def _edges_from(fc: FlowchartResult, source_id: str):
    return [e for e in fc.edges if e.source == source_id]


def test_entry_node_renders_the_exact_signature():
    fc = _flowchart("app.py::simple_branch")

    entry = next(n for n in fc.nodes if n.id == fc.entry)
    assert entry.kind == FlowNodeKind.ENTRY
    assert entry.label == "def simple_branch(x):"


def test_if_else_produces_decision_with_yes_no_edges_that_converge():
    fc = _flowchart("app.py::simple_branch")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    decision = decisions[0]
    assert decision.label == "if x > 0"

    out_edges = _edges_from(fc, decision.id)
    assert {e.label for e in out_edges} == {"Yes", "No"}
    yes_edge = next(e for e in out_edges if e.label == "Yes")
    no_edge = next(e for e in out_edges if e.label == "No")
    assert yes_edge.kind == FlowEdgeKind.TRUE
    assert no_edge.kind == FlowEdgeKind.FALSE

    yes_target = next(n for n in fc.nodes if n.id == yes_edge.target)
    no_target = next(n for n in fc.nodes if n.id == no_edge.target)
    assert yes_target.label == "y = 1"
    assert no_target.label == "y = -1"

    # Both branches converge on the same `return y` node.
    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return y"
    incoming_sources = {e.source for e in fc.edges if e.target == return_nodes[0].id}
    assert incoming_sources == {yes_target.id, no_target.id}


def test_loop_with_nested_branch_has_loop_back_edges_from_both_branches():
    fc = _flowchart("app.py::nested_branch_in_loop")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    loop = loops[0]
    assert loop.label == "for item in items"

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    assert decisions[0].label == "if item > 0"

    loop_out = _edges_from(fc, loop.id)
    assert any(
        e.kind == FlowEdgeKind.FLOW and e.target == decisions[0].id and e.label == "Loop"
        for e in loop_out
    )

    # Both the True branch (`total += item`) and the implicit False branch
    # (no `else:`) loop back to the header.
    loop_back_edges = [e for e in fc.edges if e.kind == FlowEdgeKind.LOOP_BACK]
    assert len(loop_back_edges) == 2
    assert all(e.target == loop.id for e in loop_back_edges)

    # No `else:` on the `for`, so its own "Done" exit leads straight to
    # the (explicit) `return total`.
    done_edge = next(e for e in loop_out if e.label == "Done")
    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return total"
    assert done_edge.target == return_nodes[0].id


def test_while_loop_break_and_continue_and_io_detection():
    fc = _flowchart("app.py::while_with_break_continue")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    loop = loops[0]
    assert loop.label == "while i < n"

    continue_nodes = [n for n in fc.nodes if n.label == "continue"]
    assert len(continue_nodes) == 1
    continue_edges = _edges_from(fc, continue_nodes[0].id)
    assert len(continue_edges) == 1
    assert continue_edges[0].kind == FlowEdgeKind.LOOP_BACK
    assert continue_edges[0].target == loop.id

    break_nodes = [n for n in fc.nodes if n.label == "break"]
    assert len(break_nodes) == 1

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return i"

    # Both the break and the loop's normal ("Done") exit converge on `return i`.
    incoming = {e.source: e for e in fc.edges if e.target == return_nodes[0].id}
    assert break_nodes[0].id in incoming
    assert loop.id in incoming
    assert incoming[loop.id].label == "Done"

    io_nodes = _nodes_of_kind(fc, FlowNodeKind.IO)
    assert len(io_nodes) == 1
    assert io_nodes[0].label == "print(i)"


def test_for_else_break_bypasses_else_clause():
    fc = _flowchart("app.py::for_else_example")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    loop = loops[0]

    break_nodes = [n for n in fc.nodes if n.label == "break"]
    assert len(break_nodes) == 1

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    labels = {n.label for n in return_nodes}
    assert labels == {"return -1", "return item"}

    return_minus_one = next(n for n in return_nodes if n.label == "return -1")
    return_item = next(n for n in return_nodes if n.label == "return item")

    # The loop's normal ("Done") exit runs the `else:` clause (`return -1`).
    done_edges = [e for e in _edges_from(fc, loop.id) if e.label == "Done"]
    assert len(done_edges) == 1
    assert done_edges[0].target == return_minus_one.id

    # `break` skips the `else:` clause entirely (Python semantics) and
    # lands directly on `return item`.
    break_edges = _edges_from(fc, break_nodes[0].id)
    assert len(break_edges) == 1
    assert break_edges[0].target == return_item.id


def test_multiple_explicit_returns_need_no_implicit_return_node():
    fc = _flowchart("app.py::multiple_returns")

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    labels = {n.label for n in return_nodes}
    assert labels == {"return 'negative'", "return 'zero'", "return 'positive'"}
    assert "return (implicit)" not in labels


def test_elif_chain_nests_as_a_single_decision_per_branch():
    fc = _flowchart("app.py::elif_chain")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 2
    first = next(n for n in decisions if n.label == "if x < 0")
    second = next(n for n in decisions if n.label == "if x == 0")

    # The `elif` is wired as the first decision's "No" branch -- a nested
    # decision, not a separate top-level statement.
    first_no_edge = next(e for e in _edges_from(fc, first.id) if e.label == "No")
    assert first_no_edge.target == second.id

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    labels = {n.label for n in return_nodes}
    assert labels == {"return 'negative'", "return 'zero'", "return 'positive'"}
    assert "return (implicit)" not in labels

    # The final `else` is the second decision's "No" branch.
    second_no_edge = next(e for e in _edges_from(fc, second.id) if e.label == "No")
    positive_node = next(n for n in return_nodes if n.label == "return 'positive'")
    assert second_no_edge.target == positive_node.id


def test_no_explicit_return_synthesizes_an_implicit_return_node():
    fc = _flowchart("app.py::no_explicit_return")

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return (implicit)"

    io_nodes = _nodes_of_kind(fc, FlowNodeKind.IO)
    assert len(io_nodes) == 1
    assert io_nodes[0].label == "print(item)"


def test_bare_call_to_same_file_function_gets_call_kind():
    fc = _flowchart("app.py::calls_same_file_function")

    call_nodes = _nodes_of_kind(fc, FlowNodeKind.CALL)
    assert len(call_nodes) == 1
    assert call_nodes[0].label == "add_one(x)"


def test_bare_call_to_external_function_stays_generic_statement():
    fc = _flowchart("app.py::calls_external_function")

    assert _nodes_of_kind(fc, FlowNodeKind.CALL) == []
    assert _nodes_of_kind(fc, FlowNodeKind.IO) == []
    statement_labels = {n.label for n in _nodes_of_kind(fc, FlowNodeKind.STATEMENT)}
    assert "os.getcwd()" in statement_labels


def test_ambiguous_same_name_method_does_not_resolve_to_call_kind():
    fc = _flowchart("app.py::calls_ambiguous_method")

    assert _nodes_of_kind(fc, FlowNodeKind.CALL) == []
    statement_labels = {n.label for n in _nodes_of_kind(fc, FlowNodeKind.STATEMENT)}
    assert "obj.helper()" in statement_labels
