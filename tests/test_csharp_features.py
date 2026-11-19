"""C# source location, complexity, flowcharts, signatures and test-file heuristics:
everything that works from a graph node back to its tree-sitter node."""

from pathlib import Path

import pytest

from semantic_vision import csharp_locate
from semantic_vision.ai.context import _render_csharp_signature, assemble_context
from semantic_vision.analysis.complexity import build_complexity_index
from semantic_vision.analysis.dead_code import _is_test_file, find_dead_code_candidates
from semantic_vision.analysis.duplicates import build_duplicate_groups
from semantic_vision.analysis.impact import build_reverse_caller_index
from semantic_vision.flowchart.cfg import FlowEdgeKind, FlowNodeKind, build_flowchart
from semantic_vision.models import NodeKind
from semantic_vision.repo_parser import parse_repository

FLOW = Path(__file__).parent / "fixtures" / "csharp_flow_repo"
SHOP = Path(__file__).parent / "fixtures" / "csharp_repo"
W = "Widget.cs::Widget"


@pytest.fixture(scope="module")
def flow():
    return parse_repository(FLOW, language="csharp")


@pytest.fixture(scope="module")
def shop():
    return parse_repository(SHOP, language="csharp")


def node(result, node_id):
    return next(n for n in result.nodes if n.id == node_id)


# -- locate --------------------------------------------------------------------------


def test_every_function_node_locates_to_a_tree_sitter_node(flow):
    trees, indices = {}, {}
    for n in flow.nodes:
        if n.kind == NodeKind.FUNCTION:
            assert csharp_locate.locate(FLOW, n, trees, indices) is not None, n.id


def test_every_class_node_locates_including_renamed_generic_siblings(flow):
    trees, indices = {}, {}
    ids = [n.id for n in flow.nodes if n.kind == NodeKind.CLASS]
    assert "Widget.cs::Table`1" in ids and "Widget.cs::Table`2" in ids
    for n in flow.nodes:
        if n.kind == NodeKind.CLASS:
            assert csharp_locate.locate(FLOW, n, trees, indices) is not None, n.id


def test_locate_returns_the_node_of_the_right_kind(flow):
    trees, indices = {}, {}
    cases = {
        f"{W}.SimpleBranch": "method_declaration",
        f"{W}.Value#get": "accessor_declaration",
        f"{W}.Value#set": "accessor_declaration",
        f"{W}.Computed#get": "property_declaration",
        f"{W}.operator +": "operator_declaration",
        "Widget.cs::Widget": "class_declaration",
    }
    for node_id, kind in cases.items():
        located = csharp_locate.locate(FLOW, node(flow, node_id), trees, indices)
        assert located.type == kind, node_id


def test_locate_lines_match_the_graph_even_with_conditional_compilation(shop):
    trees, indices = {}, {}
    name = node(shop, "src/Lib/Platform.cs::Platform.Name")
    located = csharp_locate.locate(SHOP, name, trees, indices)
    assert located.start_point[0] + 1 == name.line_start


# -- complexity ----------------------------------------------------------------------


@pytest.fixture(scope="module")
def scores(flow):
    return build_complexity_index(flow)


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("Trivial", 1),
        ("SimpleBranch", 2),  # if
        ("Logical", 3),  # && and ||
        ("Classify", 4),  # one point per case label: `case 0`, `case 1`, `case 2`
        ("Guarded", 2),  # ??
        ("Ternary", 2),  # ?:
        ("Catches", 2),  # catch
        ("BreaksAndContinues", 4),  # foreach + two ifs
        ("Loops", 3),  # foreach + for
    ],
)
def test_cyclomatic_complexity(scores, method, expected):
    assert scores[f"{W}.{method}"].cyclomatic_complexity == expected


def test_nested_loops_are_detected(scores):
    assert scores[f"{W}.Loops"].has_nested_loops
    assert not scores[f"{W}.SimpleBranch"].has_nested_loops


def test_every_function_gets_a_score(flow, scores):
    assert {n.id for n in flow.nodes if n.kind == NodeKind.FUNCTION} <= set(scores)


# -- duplicates ----------------------------------------------------------------------


def test_duplicate_detection_ignores_a_comment_only_difference(tmp_path):
    body = "{ var t = 0; for (var i = 0; i < n; i++) { t += i * 2; } return t; }"
    (tmp_path / "A.cs").write_text(f"class A {{ int F(int n) {body} }}")
    (tmp_path / "B.cs").write_text(f"class B {{ int G(int n) /* c */ {body} }}")
    result = parse_repository(tmp_path, language="csharp")
    groups = build_duplicate_groups(result)
    assert [sorted(g.node_ids) for g in groups] == [["A.cs::A.F", "B.cs::B.G"]]


# -- signatures ----------------------------------------------------------------------


def signature(result, root, node_id, *, strip=False):
    located = csharp_locate.locate(root, node(result, node_id), {}, {})
    return _render_csharp_signature(located, strip_decorators=strip)


def test_method_signature_is_the_real_header(flow):
    assert signature(flow, FLOW, f"{W}.SimpleBranch") == "public int SimpleBranch(int x)"


def test_expression_bodied_member_signature_stops_before_the_arrow(flow):
    assert signature(flow, FLOW, f"{W}.Trivial") == "public int Trivial()"


def test_accessor_signature_names_the_property_and_accessor(flow):
    assert signature(flow, FLOW, f"{W}.Value#get") == "public int Value { get }"


def test_attributes_are_stripped_on_request(shop):
    node_id = "tests/App.Tests/OrderServiceTests.cs::OrderServiceTests.Creates"
    assert signature(shop, SHOP, node_id).startswith("[Fact]")
    assert signature(shop, SHOP, node_id, strip=True) == "public async Task Creates()"


def test_ai_context_uses_a_csharp_fence_and_the_real_signature(shop):
    ctx = assemble_context(shop, "src/Lib/Models/OrderLine.cs::OrderLine.Price")
    assert "```csharp" in ctx.prompt
    assert "public decimal Price()" in ctx.prompt


# -- flowcharts ----------------------------------------------------------------------


def kinds(fc):
    return [n.kind for n in fc.nodes]


def test_entry_renders_the_signature_and_ends_in_an_implicit_return(flow):
    fc = build_flowchart(flow, f"{W}.Calls")
    entry = next(n for n in fc.nodes if n.id == fc.entry)
    assert entry.kind == FlowNodeKind.ENTRY and entry.label == "public void Calls()"
    assert any(n.label == "return (implicit)" for n in fc.nodes)


def test_if_else_has_yes_and_no_branches(flow):
    fc = build_flowchart(flow, f"{W}.SimpleBranch")
    decision = next(n for n in fc.nodes if n.kind == FlowNodeKind.DECISION)
    assert decision.label == "if x > 0"
    assert {e.label for e in fc.edges if e.source == decision.id} == {"Yes", "No"}
    assert kinds(fc).count(FlowNodeKind.RETURN) == 2


def test_foreach_and_for_loops_have_back_edges(flow):
    fc = build_flowchart(flow, f"{W}.Loops")
    loops = [n for n in fc.nodes if n.kind == FlowNodeKind.LOOP]
    assert [n.label for n in loops] == ["foreach (var x in xs)", "for (var i = 0; i < x; i++)"]
    outer, inner = loops
    for loop in loops:
        assert any(e.target == loop.id and e.kind == FlowEdgeKind.LOOP_BACK for e in fc.edges)
        assert "Loop" in {e.label for e in fc.edges if e.source == loop.id}
    # The outer loop exits ("Done") to the code after it; the inner loop's exit is the
    # outer loop's next iteration, so it is drawn as the back-edge instead.
    assert "Done" in {e.label for e in fc.edges if e.source == outer.id}
    assert any(e.source == inner.id and e.target == outer.id for e in fc.edges)


def test_do_while_checks_after_the_body(flow):
    fc = build_flowchart(flow, f"{W}.DoLoop")
    loop = next(n for n in fc.nodes if n.kind == FlowNodeKind.LOOP)
    assert loop.label == "do...while i < 3"
    assert any(e.source == loop.id and e.kind == FlowEdgeKind.LOOP_BACK for e in fc.edges)


def test_switch_sections_become_labelled_edges_with_fallthrough_forwarding(flow):
    fc = build_flowchart(flow, f"{W}.Classify")
    decision = next(n for n in fc.nodes if n.kind == FlowNodeKind.DECISION)
    assert decision.label == "switch n"
    labels = {e.label for e in fc.edges if e.source == decision.id}
    # `case 1:` has no statements of its own and forwards to `case 2:`'s node.
    assert {"0", "default"} <= labels
    assert kinds(fc).count(FlowNodeKind.RETURN) == 3
    assert "no match" not in labels  # there is a default


def test_break_leaves_the_loop_and_continue_returns_to_it(flow):
    fc = build_flowchart(flow, f"{W}.BreaksAndContinues")
    loop = next(n for n in fc.nodes if n.kind == FlowNodeKind.LOOP)
    cont = next(n for n in fc.nodes if n.label == "continue")
    brk = next(n for n in fc.nodes if n.label == "break")
    assert any(e.source == cont.id and e.target == loop.id for e in fc.edges)
    assert not any(e.source == brk.id and e.target == loop.id for e in fc.edges)


def test_calls_are_classified(flow):
    fc = build_flowchart(flow, f"{W}.Calls")
    assert FlowNodeKind.CALL in kinds(fc)  # Work() is defined in this file
    assert FlowNodeKind.IO in kinds(fc)  # Console.WriteLine


def test_try_catch_is_one_opaque_statement(flow):
    fc = build_flowchart(flow, f"{W}.Catches")
    assert not any(n.kind == FlowNodeKind.DECISION for n in fc.nodes)
    assert any(n.label.startswith("try") for n in fc.nodes)


def test_using_block_flows_into_its_body(flow):
    fc = build_flowchart(flow, f"{W}.UsesUsing")
    labels = [n.label for n in fc.nodes]
    assert any(label.startswith("using") for label in labels)
    assert 'sw.Write("x");' in labels and "Work();" in labels


def test_expression_bodied_member_is_a_single_statement(flow):
    fc = build_flowchart(flow, f"{W}.Trivial")
    assert [n.label for n in fc.nodes if n.kind == FlowNodeKind.STATEMENT] == ["1"]


def test_abstract_member_has_a_no_body_node(flow):
    fc = build_flowchart(flow, "Widget.cs::Base.Run")
    assert any(n.label == "(no body)" for n in fc.nodes)


def test_accessor_flowchart_returns(flow):
    fc = build_flowchart(flow, f"{W}.Value#get")
    assert any(n.kind == FlowNodeKind.RETURN for n in fc.nodes)


# -- dead-code heuristics --------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "tests/Foo.Tests/BarTests.cs",
        "src/Foo.UnitTests/Anything.cs",
        "src/Foo/OrderServiceTest.cs",
        "src/Foo/QueryTestBase.cs",
        "src/Foo/SharedFixture.cs",
        "test/Foo/Bar.cs",
    ],
)
def test_csharp_test_files_are_recognised(path):
    assert _is_test_file(path)


@pytest.mark.parametrize("path", ["src/Foo/Latest.cs", "src/Foo/Contest.cs", "src/Foo/Bar.cs"])
def test_ordinary_csharp_files_are_not_test_files(path):
    assert not _is_test_file(path)


def test_attribute_override_and_accessor_methods_are_not_reported_dead(shop):
    index = build_reverse_caller_index(shop.edges)
    dead = {c.node_id for c in find_dead_code_candidates(shop.nodes, index, root=SHOP)}
    assert "tests/App.Tests/OrderServiceTests.cs::OrderServiceTests.Creates" not in dead
    assert "src/Lib/Shapes/Shape.cs::Circle.Describe" not in dead  # override
    assert "src/Lib/Shapes/Shape.cs::Circle.Area" not in dead  # override
    assert "src/Lib/Shapes/Shape.cs::Square.Area" not in dead
    assert "src/Lib/Models/Order.cs::Order.Total#get" not in dead  # property accessor
    # A genuinely unused method is still found.
    assert "src/Lib/Util/StringExtensions.cs::StringExtensions.IsBlank" in dead
