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
