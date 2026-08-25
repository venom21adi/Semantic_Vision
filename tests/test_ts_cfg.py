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
    result = parse_repository(str(FIXTURES / "flowchart_repo_js"), language="javascript")
    return build_flowchart(result, node_id)


def _nodes_of_kind(fc: FlowchartResult, kind: FlowNodeKind):
    return [n for n in fc.nodes if n.kind == kind]


def _edges_from(fc: FlowchartResult, source_id: str):
    return [e for e in fc.edges if e.source == source_id]


def test_entry_node_renders_the_exact_signature():
    fc = _flowchart("app.ts::simpleBranch")

    entry = next(n for n in fc.nodes if n.id == fc.entry)
    assert entry.kind == FlowNodeKind.ENTRY
    assert entry.label == "function simpleBranch(x: number): number"


def test_if_else_produces_decision_with_yes_no_edges_that_converge():
    fc = _flowchart("app.ts::simpleBranch")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    decision = decisions[0]
    assert decision.label == "if (x > 0)"

    out_edges = _edges_from(fc, decision.id)
    assert {e.label for e in out_edges} == {"Yes", "No"}
    yes_edge = next(e for e in out_edges if e.label == "Yes")
    no_edge = next(e for e in out_edges if e.label == "No")
    assert yes_edge.kind == FlowEdgeKind.TRUE
    assert no_edge.kind == FlowEdgeKind.FALSE

    yes_target = next(n for n in fc.nodes if n.id == yes_edge.target)
    no_target = next(n for n in fc.nodes if n.id == no_edge.target)
    assert yes_target.label == "y = 1;"
    assert no_target.label == "y = -1;"

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return y;"
    incoming_sources = {e.source for e in fc.edges if e.target == return_nodes[0].id}
    assert incoming_sources == {yes_target.id, no_target.id}


def test_for_of_loop_with_nested_branch_has_loop_back_edges_from_both_branches():
    fc = _flowchart("app.ts::nestedBranchInLoop")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    loop = loops[0]
    assert loop.label == "for (const item of items)"

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    assert decisions[0].label == "if (item > 0)"

    loop_out = _edges_from(fc, loop.id)
    assert any(
        e.kind == FlowEdgeKind.FLOW and e.target == decisions[0].id and e.label == "Loop"
        for e in loop_out
    )

    loop_back_edges = [e for e in fc.edges if e.kind == FlowEdgeKind.LOOP_BACK]
    assert len(loop_back_edges) == 2
    assert all(e.target == loop.id for e in loop_back_edges)

    done_edge = next(e for e in loop_out if e.label == "Done")
    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return total;"
    assert done_edge.target == return_nodes[0].id


def test_while_loop_break_and_continue_and_io_detection():
    fc = _flowchart("app.ts::whileWithBreakContinue")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    loop = loops[0]
    assert loop.label == "while (i < n)"

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
    assert return_nodes[0].label == "return i;"

    incoming = {e.source: e for e in fc.edges if e.target == return_nodes[0].id}
    assert break_nodes[0].id in incoming
    assert loop.id in incoming
    assert incoming[loop.id].label == "Done"

    io_nodes = _nodes_of_kind(fc, FlowNodeKind.IO)
    assert len(io_nodes) == 1
    assert io_nodes[0].label == "console.log(i);"


def test_do_while_body_runs_before_the_condition_is_ever_checked():
    """`do...while` has no Python equivalent -- the body must be the
    statement's own entry point (what the enclosing block connects to),
    not the condition/loop node, since the body runs unconditionally
    before the condition is checked for the first time."""
    fc = _flowchart("app.ts::doWhileLoop")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    condition_node = loops[0]
    assert condition_node.label == "do...while (i < n)"

    body_node = next(n for n in fc.nodes if n.label == "i++;")

    # `let i = 0;` connects straight to the body, not the condition node.
    let_node = next(n for n in fc.nodes if n.label == "let i = 0;")
    let_edges = _edges_from(fc, let_node.id)
    assert len(let_edges) == 1
    assert let_edges[0].target == body_node.id

    # The body's own fall-through reaches the condition check.
    assert any(
        e.kind == FlowEdgeKind.FLOW and e.target == condition_node.id
        for e in _edges_from(fc, body_node.id)
    )
    # The condition, once true, loops back to the body.
    loop_back = next(
        e for e in _edges_from(fc, condition_node.id) if e.kind == FlowEdgeKind.LOOP_BACK
    )
    assert loop_back.target == body_node.id

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    done_edge = next(e for e in _edges_from(fc, condition_node.id) if e.label == "Done")
    assert done_edge.target == return_nodes[0].id


def test_for_in_loop_renders_correctly():
    fc = _flowchart("app.ts::forInLoop")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    assert loops[0].label == "for (const key in obj)"

    io_nodes = _nodes_of_kind(fc, FlowNodeKind.IO)
    assert len(io_nodes) == 1
    assert io_nodes[0].label == "console.log(key);"


def test_switch_fallthrough_converges_empty_and_non_terminated_cases():
    """`case 2:` (empty, no statements before `case 3:`) produces no node
    of its own -- the switch's decision edges for both `2` and `3` must
    resolve to the SAME node (case 3's own content). `case 3:` itself has
    no `break`, so its own fall-through must also reach `default:`."""
    fc = _flowchart("app.ts::switchWithFallthrough")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    switch_node = decisions[0]
    assert switch_node.label == "switch (v)"

    out_edges = {e.label: e.target for e in _edges_from(fc, switch_node.id)}
    assert set(out_edges) == {"1", "2", "3", "default"}
    # The empty `case 2:` resolves to the exact same target as `case 3:`.
    assert out_edges["2"] == out_edges["3"]

    case_two_three_target = next(n for n in fc.nodes if n.id == out_edges["3"])
    assert case_two_three_target.label == "doTwo();"

    default_target = next(n for n in fc.nodes if n.id == out_edges["default"])
    assert default_target.label == "doDefault();"

    # `case 3:`'s fall-through (no break) reaches `default:`.
    assert any(
        e.target == default_target.id and e.label is None
        for e in _edges_from(fc, case_two_three_target.id)
    )

    # `case 1:`'s own `break;` and `default:`'s own fall-through (last
    # case, no next case to fall into) both converge on the return.
    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    break_node = next(n for n in fc.nodes if n.label == "break")
    incoming = {e.source for e in fc.edges if e.target == return_nodes[0].id}
    assert break_node.id in incoming
    assert default_target.id in incoming


def test_switch_with_no_matching_case_and_no_default_falls_straight_through():
    fc = _flowchart("app.ts::switchNoDefault")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    switch_node = decisions[0]

    no_match_edge = next(e for e in _edges_from(fc, switch_node.id) if e.label == "no match")
    after_node = next(n for n in fc.nodes if n.label == "after();")
    assert no_match_edge.target == after_node.id

    # `case 1:`'s own content (no break) ALSO reaches `after()` via its
    # own fall-through -- both paths converge on the same node.
    case_one_edge = next(e for e in _edges_from(fc, switch_node.id) if e.label == "1")
    case_one_target = next(n for n in fc.nodes if n.id == case_one_edge.target)
    assert any(e.target == after_node.id for e in _edges_from(fc, case_one_target.id))


def test_labeled_continue_targets_the_labeled_outer_loop_not_the_inner_one():
    fc = _flowchart("app.ts::labeledBreakContinue")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 2
    outer_loop = next(n for n in loops if n.label == "for (const row of matrix)")
    inner_loop = next(n for n in loops if n.label == "for (const cell of row)")

    continue_node = next(n for n in fc.nodes if n.label == "continue outer")
    continue_edges = _edges_from(fc, continue_node.id)
    assert len(continue_edges) == 1
    assert continue_edges[0].kind == FlowEdgeKind.LOOP_BACK
    assert continue_edges[0].target == outer_loop.id
    assert continue_edges[0].target != inner_loop.id


def test_labeled_break_exits_both_loops_entirely():
    fc = _flowchart("app.ts::labeledBreakContinue")

    break_node = next(n for n in fc.nodes if n.label == "break outer")
    break_edges = _edges_from(fc, break_node.id)
    assert len(break_edges) == 1

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert break_edges[0].target == return_nodes[0].id


def test_multiple_explicit_returns_need_no_implicit_return_node():
    fc = _flowchart("app.ts::multipleReturns")

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    labels = {n.label for n in return_nodes}
    assert labels == {'return "negative";', 'return "zero";', 'return "positive";'}
    assert "return (implicit)" not in labels


def test_elif_chain_nests_as_a_single_decision_per_branch():
    fc = _flowchart("app.ts::elifChain")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 2
    first = next(n for n in decisions if n.label == "if (x < 0)")
    second = next(n for n in decisions if n.label == "if (x === 0)")

    first_no_edge = next(e for e in _edges_from(fc, first.id) if e.label == "No")
    assert first_no_edge.target == second.id

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    labels = {n.label for n in return_nodes}
    assert labels == {'return "negative";', 'return "zero";', 'return "positive";'}

    second_no_edge = next(e for e in _edges_from(fc, second.id) if e.label == "No")
    positive_node = next(n for n in return_nodes if n.label == 'return "positive";')
    assert second_no_edge.target == positive_node.id


def test_no_explicit_return_synthesizes_an_implicit_return_node():
    fc = _flowchart("app.ts::noExplicitReturn")

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return (implicit)"

    io_nodes = _nodes_of_kind(fc, FlowNodeKind.IO)
    assert len(io_nodes) == 1
    assert io_nodes[0].label == "console.log(item);"


def test_bare_call_to_same_file_function_gets_call_kind():
    fc = _flowchart("app.ts::callsSameFileFunction")

    call_nodes = _nodes_of_kind(fc, FlowNodeKind.CALL)
    assert len(call_nodes) == 1
    assert call_nodes[0].label == "addOne(x);"


def test_bare_call_to_external_function_stays_generic_statement():
    fc = _flowchart("app.ts::callsExternalFunction")

    assert _nodes_of_kind(fc, FlowNodeKind.CALL) == []
    assert _nodes_of_kind(fc, FlowNodeKind.IO) == []
    statement_labels = {n.label for n in _nodes_of_kind(fc, FlowNodeKind.STATEMENT)}
    assert "Math.max(1, 2);" in statement_labels


def test_ambiguous_same_name_method_does_not_resolve_to_call_kind():
    fc = _flowchart("app.ts::callsAmbiguousMethod")

    assert _nodes_of_kind(fc, FlowNodeKind.CALL) == []
    statement_labels = {n.label for n in _nodes_of_kind(fc, FlowNodeKind.STATEMENT)}
    assert "obj.helper();" in statement_labels


def test_concise_arrow_body_becomes_a_single_implicit_return_node():
    fc = _flowchart("app.ts::conciseArrow")

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "x + 1"
    assert fc.entry == next(n for n in fc.nodes if n.kind == FlowNodeKind.ENTRY).id


def test_unlabeled_break_inside_a_switch_inside_a_loop_only_breaks_the_switch():
    """An unlabeled `break` targets the nearest enclosing *breakable*
    context, which for a `switch` nested inside a `for` is the switch
    itself, not the loop -- confirmed here by checking the break lands on
    code that's still inside the loop (and loops back), not on the
    function's own exit."""
    fc = _flowchart("app.ts::switchInsideLoop")

    loops = _nodes_of_kind(fc, FlowNodeKind.LOOP)
    assert len(loops) == 1
    loop = loops[0]

    break_node = next(n for n in fc.nodes if n.label == "break")
    after_node = next(n for n in fc.nodes if n.label == "after();")
    break_edges = _edges_from(fc, break_node.id)
    assert len(break_edges) == 1
    assert break_edges[0].target == after_node.id

    # `after()` is still inside the loop -- it loops back, rather than
    # exiting straight to the function's return.
    after_edges = _edges_from(fc, after_node.id)
    assert len(after_edges) == 1
    assert after_edges[0].kind == FlowEdgeKind.LOOP_BACK
    assert after_edges[0].target == loop.id


def test_braced_switch_case_body_is_unwrapped_not_swallowed_as_one_opaque_node():
    """Regression: a first implementation took a `switch` case's own
    statements without unwrapping a braced case body (`case 1: { ... }`
    -- the pattern TS/ESLint's `no-case-declarations` rule pushes
    developers toward, to scope `let`/`const` per case), so the whole
    braced block fell through to the generic opaque-statement case,
    silently erasing its internal `break` and misrepresenting case 1 as
    falling through into case 2 even though it has an explicit `break`."""
    fc = _flowchart("app.ts::switchWithBracedCase")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    switch_node = decisions[0]

    # The braced case's own statements are real, separate nodes now --
    # not one opaque block.
    let_node = next(n for n in fc.nodes if n.label == "let x = 1;")
    call_node = next(n for n in fc.nodes if n.label == "doOne();")
    break_node = next(n for n in fc.nodes if n.label == "break")
    assert _edges_from(fc, let_node.id)[0].target == call_node.id
    assert _edges_from(fc, call_node.id)[0].target == break_node.id

    # Case 1's `break` reaches the function's return directly -- it does
    # NOT fall through into case 2's content.
    case_two_target_id = next(e.target for e in _edges_from(fc, switch_node.id) if e.label == "2")
    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    break_edges = _edges_from(fc, break_node.id)
    assert len(break_edges) == 1
    assert break_edges[0].target == return_nodes[0].id
    assert break_edges[0].target != case_two_target_id


def test_bare_block_statement_is_unwrapped_not_swallowed_as_one_opaque_node():
    """Regression: a bare `{ ... }` block statement (not a switch case,
    not a function/if/loop body -- just a standalone scoping block) hit
    the same opaque-statement fallback, erasing a real conditional early
    return inside it from the graph entirely."""
    fc = _flowchart("app.ts::bareBlockWithConditionalReturn")

    decisions = _nodes_of_kind(fc, FlowNodeKind.DECISION)
    assert len(decisions) == 1
    assert decisions[0].label == "if (y > 0)"

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    labels = {n.label for n in return_nodes}
    assert labels == {"return y;", "return -1;"}

    out_edges = _edges_from(fc, decisions[0].id)
    yes_edge = next(e for e in out_edges if e.label == "Yes")
    no_edge = next(e for e in out_edges if e.label == "No")
    yes_target = next(n for n in fc.nodes if n.id == yes_edge.target)
    no_target = next(n for n in fc.nodes if n.id == no_edge.target)
    assert yes_target.label == "return y;"
    assert no_target.label == "return -1;"


def test_try_catch_finally_is_not_specially_modeled_but_does_not_crash():
    """Matches Python's own precedent: `try`/`except` isn't given real
    branching representation there either (a `finally`'s always-runs
    semantics and a `catch`'s only-some-exceptions handling are real
    complexity a flattened walk would misrepresent) -- so JS/TS's
    `try`/`catch`/`finally` becomes one opaque statement node too, not a
    crash and not a silently wrong partial model."""
    fc = _flowchart("app.ts::withTryCatchFinally")

    assert _nodes_of_kind(fc, FlowNodeKind.DECISION) == []
    statement_labels = {n.label for n in _nodes_of_kind(fc, FlowNodeKind.STATEMENT)}
    assert any(label.startswith("try {") for label in statement_labels)

    return_nodes = _nodes_of_kind(fc, FlowNodeKind.RETURN)
    assert len(return_nodes) == 1
    assert return_nodes[0].label == "return 1;"
