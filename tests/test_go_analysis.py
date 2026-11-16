"""Go parity for the analysis features that branch per language:
complexity, flowcharts, AI-doc context, duplicates, dead code. The plan
flagged these as the places a new language silently falls through to the
Python path -- these tests pin that each has an explicit Go branch."""

from pathlib import Path

import pytest

from semantic_vision.ai.context import assemble_context
from semantic_vision.analysis.complexity import build_complexity_index
from semantic_vision.analysis.dead_code import find_dead_code_candidates
from semantic_vision.analysis.duplicates import build_duplicate_groups
from semantic_vision.analysis.impact import build_reverse_caller_index
from semantic_vision.flowchart.cfg import build_flowchart
from semantic_vision.flowchart.model import FlowEdgeKind, FlowNodeKind
from semantic_vision.repo_parser import parse_repository

FIXTURE = Path(__file__).parent / "fixtures" / "go_analysis_repo"


@pytest.fixture(scope="module")
def repo():
    return parse_repository(FIXTURE, language="go")


def test_complexity_is_computed_from_go_source_not_defaulted(repo):
    scores = {k.split("::")[1]: v for k, v in build_complexity_index(repo).items()}
    assert scores["Simple"].cyclomatic_complexity == 1
    # 1 + if + && + else-if + || + range-for + for + inner-if + 2 cases = 10
    # (`default` and `fallthrough` add nothing)
    assert scores["Branchy"].cyclomatic_complexity == 10
    assert scores["Branchy"].has_nested_loops is True
    # for + select case (default adds nothing) + if = 4
    assert scores["Looper"].cyclomatic_complexity == 4
    assert scores["Looper"].has_nested_loops is False


def edges(chart):
    labels = {n.id: n.label for n in chart.nodes}
    return {(labels[e.source], labels[e.target], e.kind, e.label) for e in chart.edges}


def test_flowchart_models_branches_loops_and_explicit_fallthrough(repo):
    chart = build_flowchart(repo, "main.go::Branchy")
    kinds = {n.label: n.kind for n in chart.nodes}
    assert kinds["func Branchy(a, b int, items []int) int"] == FlowNodeKind.ENTRY
    assert kinds["if a > 0 && b > 0"] == FlowNodeKind.DECISION
    assert kinds["for _, x := range items"] == FlowNodeKind.LOOP
    assert kinds["for i := 0; i < x; i++"] == FlowNodeKind.LOOP
    assert kinds["switch a"] == FlowNodeKind.DECISION
    assert kinds['fmt.Println("both")'] == FlowNodeKind.IO

    found = edges(chart)
    assert ("if a > 0 && b > 0", 'fmt.Println("both")', FlowEdgeKind.TRUE, "Yes") in found
    # `continue` jumps back to the innermost loop header
    assert ("continue", "for i := 0; i < x; i++", FlowEdgeKind.LOOP_BACK, None) in found
    # `case 2, 3: fallthrough` flows into `default`, not out of the switch
    assert ("switch a", "b++", FlowEdgeKind.FLOW, "case 2, 3") in found
    assert ("switch a", "b++", FlowEdgeKind.FLOW, "default") in found
    assert ("b++", "return b", FlowEdgeKind.FLOW, None) in found


def test_flowchart_labeled_break_select_and_infinite_loop(repo):
    chart = build_flowchart(repo, "main.go::Looper")
    found = edges(chart)
    labels = {n.label for n in chart.nodes}
    assert "for" in labels  # `for {}` header
    assert "break outer" in labels
    # `for {}` has no "Done" exit; only the labeled break leaves it, to `defer`.
    assert not any(label == "Done" for *_rest, label in found)
    assert ("break outer", "defer cleanup()", FlowEdgeKind.FLOW, None) in found
    # `select` never gets a "no match" exit.
    assert not any(label == "no match" for *_rest, label in found)


def test_ai_context_uses_go_signature_and_fence(repo):
    ctx = assemble_context(repo, "main.go::Branchy")
    text = ctx.prompt if hasattr(ctx, "prompt") else str(ctx)
    assert "func Branchy(a, b int, items []int) int" in text
    assert "```go" in text
    assert "def " not in text.split("```go")[0]


def test_duplicates_ignore_go_comments_and_names(tmp_path):
    body = "\tx := 1\n\tif x > 0 {\n\t\tx = x + 2\n\t}\n\treturn x\n"
    (tmp_path / "a.go").write_text(
        f"package a\n\nfunc One() int {{\n{body}}}\n\n"
        f"func Two() int {{\n\t// a comment\n{body}}}\n",
        encoding="utf-8",
    )
    groups = build_duplicate_groups(parse_repository(tmp_path, language="go"))
    assert [sorted(g.node_ids) for g in groups] == [["a.go::One", "a.go::Two"]]


def test_dead_code_skips_go_init_main_and_test_files(repo):
    reverse = build_reverse_caller_index(repo.edges)
    dead = {
        c.node_id.split("::")[1]
        for c in find_dead_code_candidates(repo.nodes, reverse, root=Path(repo.root))
    }
    assert "init" not in dead  # runs automatically
    assert "TestHelper" not in dead  # lives in a _test.go file
    assert "cleanup" not in dead  # called via defer
    assert {"Branchy", "Looper", "TestSomething"} <= dead
