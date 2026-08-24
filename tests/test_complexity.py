from pathlib import Path

from semantic_vision.analysis.complexity import ComplexityScore, build_complexity_index
from semantic_vision.repo_parser import parse_repository

FIXTURES = Path(__file__).parent / "fixtures"


def _scores(max_call_chain_depth: int = 5) -> dict[str, ComplexityScore]:
    result = parse_repository(str(FIXTURES / "complexity_repo"))
    return build_complexity_index(result, max_call_chain_depth=max_call_chain_depth)


def _score(node_id: str, scores: dict[str, ComplexityScore] | None = None) -> ComplexityScore:
    return (scores or _scores())[f"app.py::{node_id}"]


def test_trivial_function_has_complexity_one():
    score = _score("trivial")

    assert score.cyclomatic_complexity == 1
    assert score.call_chain_depth == 0
    assert score.has_nested_loops is False


def test_nested_if_elif_else_counts_each_decision():
    score = _score("nested_if_elif_else")

    assert score.cyclomatic_complexity == 3


def test_loop_with_boolean_condition_counts_loop_if_and_extra_boolop_operand():
    score = _score("loop_with_boolean_condition")

    # base(1) + for(1) + if(1) + boolop "and" extra operand(1) = 4
    assert score.cyclomatic_complexity == 4
    assert score.has_nested_loops is False


def test_nested_loop_is_flagged_separately_from_the_complexity_count():
    score = _score("nested_loop")

    # base(1) + outer for(1) + inner for(1) = 3
    assert score.cyclomatic_complexity == 3
    assert score.has_nested_loops is True


def test_comprehension_if_adds_one_decision():
    score = _score("comprehension_with_filter")

    assert score.cyclomatic_complexity == 2


def test_match_case_counts_non_wildcard_cases_only():
    score = _score("match_example")

    # base(1) + `case 1`(1) + `case 2`(1); `case _` is excluded
    assert score.cyclomatic_complexity == 3


def test_ternary_expression_counts_as_a_decision_point():
    score = _score("ternary_expression")

    assert score.cyclomatic_complexity == 2


def test_async_for_with_a_branch_counts_both():
    score = _score("async_with_decision")

    # base(1) + async for(1) + if(1) = 3
    assert score.cyclomatic_complexity == 3
    assert score.has_nested_loops is False


def test_except_handlers_each_count_as_a_decision_point():
    score = _score("try_except_example")

    # base(1) + 2 except handlers = 3
    assert score.cyclomatic_complexity == 3


def test_sibling_loops_are_not_flagged_as_nested():
    score = _score("sibling_loops")

    # base(1) + 2 independent for loops = 3
    assert score.cyclomatic_complexity == 3
    assert score.has_nested_loops is False


def test_match_guard_clause_does_not_add_its_own_decision_point():
    score = _score("match_with_guard")

    # base(1) + `case int() as n if n > 0`(1); `case _` is excluded
    assert score.cyclomatic_complexity == 2


def test_long_call_chain_with_no_branches_still_scores_complexity_one():
    score = _score("chain_step_0")

    assert score.cyclomatic_complexity == 1


def test_call_chain_depth_counts_the_real_hop_count_when_unbounded():
    # chain_step_0 -> ... -> chain_step_6 is a real, non-cyclic 6-hop chain.
    # A max_call_chain_depth of 5 (the default) would cap it short of the
    # true depth, so this asserts against a wider bound instead.
    score = _score("chain_step_0", _scores(max_call_chain_depth=10))

    assert score.call_chain_depth == 6


def test_call_chain_depth_cap_is_honored_on_a_cyclic_chain():
    # cyclic_0 -> cyclic_1 -> ... -> cyclic_7 -> cyclic_0 is an 8-node ring.
    # Uncapped, per-path cycle detection alone would still terminate (at
    # depth 7, the last new node before the ring closes) -- but the
    # default max_call_chain_depth=5 cap should cut it off earlier than
    # that, proving the cap actually engages rather than only relying on
    # cycle detection to keep the walk bounded.
    score = _score("cyclic_0")

    assert score.call_chain_depth == 5


# --- JS/TS (tree-sitter) -- mirrors the Python cases above one-for-one
# where a real JS/TS equivalent exists (JS has no comprehension or
# match-guard analogue), plus two cases specific to the documented
# lambda-vs-nested-def divergence in `_ts_cyclomatic_complexity`.

JS_FIXTURES = Path(__file__).parent / "fixtures" / "complexity_repo_js"


def _js_scores(max_call_chain_depth: int = 5) -> dict[str, ComplexityScore]:
    result = parse_repository(str(JS_FIXTURES), language="javascript")
    return build_complexity_index(result, max_call_chain_depth=max_call_chain_depth)


def _js_score(node_id: str, scores: dict[str, ComplexityScore] | None = None) -> ComplexityScore:
    return (scores or _js_scores())[f"app.ts::{node_id}"]


def test_js_trivial_function_has_complexity_one():
    score = _js_score("trivial")

    assert score.cyclomatic_complexity == 1
    assert score.call_chain_depth == 0
    assert score.has_nested_loops is False


def test_js_if_else_if_else_counts_each_decision():
    score = _js_score("nestedIfElseIf")

    assert score.cyclomatic_complexity == 3


def test_js_for_of_with_boolean_condition_counts_loop_if_and_logical_operator():
    score = _js_score("loopWithBooleanCondition")

    # base(1) + for...of(1) + if(1) + "&&"(1) = 4
    assert score.cyclomatic_complexity == 4
    assert score.has_nested_loops is False


def test_js_nested_loop_is_flagged_separately_from_the_complexity_count():
    score = _js_score("nestedLoop")

    # base(1) + outer for...of(1) + inner for...of(1) = 3
    assert score.cyclomatic_complexity == 3
    assert score.has_nested_loops is True


def test_js_for_in_loop_counts_as_a_decision_point():
    score = _js_score("forInLoop")

    assert score.cyclomatic_complexity == 2


def test_js_switch_counts_non_default_cases_only():
    score = _js_score("switchExample")

    # base(1) + `case 1`(1) + `case 2`(1); `default` is excluded
    assert score.cyclomatic_complexity == 3


def test_js_ternary_expression_counts_as_a_decision_point():
    score = _js_score("ternaryExpression")

    assert score.cyclomatic_complexity == 2


def test_js_for_await_of_with_a_branch_counts_both():
    score = _js_score("asyncWithDecision")

    # base(1) + for await...of(1) + if(1) = 3
    assert score.cyclomatic_complexity == 3
    assert score.has_nested_loops is False


def test_js_catch_clause_counts_as_a_decision_point():
    score = _js_score("tryCatchExample")

    # base(1) + 1 catch clause (JS allows only one per try) = 2
    assert score.cyclomatic_complexity == 2


def test_js_while_and_do_while_each_count_as_a_loop():
    score = _js_score("whileAndDoWhile")

    assert score.cyclomatic_complexity == 3


def test_js_sibling_loops_are_not_flagged_as_nested():
    score = _js_score("siblingLoops")

    # base(1) + 2 independent for...of loops = 3
    assert score.cyclomatic_complexity == 3
    assert score.has_nested_loops is False


def test_js_three_term_logical_chain_converges_to_pythons_extra_operand_count():
    score = _js_score("tripleLogicalChain")

    # `a && b && c` nests as two `binary_expression` nodes in this
    # grammar (unlike Python's flat `BoolOp.values`), so +1 per node
    # converges to the same total Python's "+1 per extra operand" gives
    # for the equivalent flattened expression: base(1) + 2 = 3.
    assert score.cyclomatic_complexity == 3


def test_js_nullish_coalescing_and_logical_assignment_each_count():
    score = _js_score("nullishAndLogicalAssignment")

    # base(1) + "??"(1) + "??="(1) + "||="(1) + "&&="(1) = 5
    assert score.cyclomatic_complexity == 5


def test_js_callback_branching_flattens_into_the_enclosing_function():
    score = _js_score("callbackBranchingFlattensIntoEnclosing")

    # An inline arrow callback has no graph node of its own (like a
    # Python lambda) -- its `if` is walked through, not stopped at.
    # base(1) + if(1) = 2
    assert score.cyclomatic_complexity == 2


def test_js_named_nested_function_does_not_inflate_its_enclosing_score():
    score = _js_score("namedNestedFunctionDoesNotInflateEnclosing")

    # A nested named `function` statement is opaque here, matching
    # Python's nested-`def` treatment -- its `if` is not counted.
    assert score.cyclomatic_complexity == 1


def test_js_long_call_chain_with_no_branches_still_scores_complexity_one():
    score = _js_score("chainStep0")

    assert score.cyclomatic_complexity == 1


def test_js_call_chain_depth_counts_the_real_hop_count_when_unbounded():
    score = _js_score("chainStep0", _js_scores(max_call_chain_depth=10))

    assert score.call_chain_depth == 6


def test_js_call_chain_depth_cap_is_honored_on_a_cyclic_chain():
    score = _js_score("cyclic0")

    assert score.call_chain_depth == 5
