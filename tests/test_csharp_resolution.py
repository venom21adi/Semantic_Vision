"""End-to-end C# resolution through `parse_repository` on `fixtures/csharp_repo`.

Every expectation here was checked against the real C# compiler's semantic model
(`scripts/csharp/validate.py` reports 100% recall and precision on this fixture);
this file pins the same behaviour without needing the .NET SDK."""

from pathlib import Path

import pytest

from semantic_vision.models import EdgeKind
from semantic_vision.repo_parser import parse_repository

FIXTURE = Path(__file__).parent / "fixtures" / "csharp_repo"
SVC = "src/App/Services/OrderService.cs::OrderService"
ORDER = "src/Lib/Models/Order.cs::Order"


@pytest.fixture(scope="module")
def result():
    return parse_repository(FIXTURE, language="csharp")


def calls_from(result, source: str):
    return {
        (e.target, e.external, e.ambiguous)
        for e in result.edges
        if e.kind == EdgeKind.CALLS and e.source == source
    }


def targets_from(result, source: str):
    return {t for t, _, _ in calls_from(result, source)}


# -- graph shape ---------------------------------------------------------------------


def test_the_fixture_parses_without_errors(result):
    assert result.parse_errors == []


def test_partial_class_is_one_node_per_file(result):
    ids = {n.id for n in result.nodes if n.label == "Order" and n.kind.value == "class"}
    assert ids == {
        ORDER,
        "src/Lib/Models/Order.Totals.cs::Order",
        "src/Other/Order.cs::Order",
    }


def test_overloads_property_accessors_and_generic_siblings_have_distinct_ids(result):
    ids = {n.id for n in result.nodes}
    assert {f"{ORDER}.AddLine#1", f"{ORDER}.AddLine#2"} <= ids
    assert {f"{ORDER}.Total#get", f"{ORDER}.Total#set"} <= ids
    assert {"src/Lib/Util/Repo.cs::Repo`1", "src/Lib/Util/Repo.cs::Repo`2"} <= ids


def test_auto_properties_make_no_function_nodes(result):
    labels = {n.label for n in result.nodes if n.kind.value == "function"}
    assert "Id" not in labels and "Discount" not in labels


# -- resolution ----------------------------------------------------------------------


def test_overload_is_chosen_by_argument_count_and_type(result):
    targets = targets_from(result, f"{SVC}.CreateAsync")
    assert f"{ORDER}.AddLine#2" in targets  # AddLine(sku, quantity)
    assert f"{ORDER}.AddLine#1" in targets  # AddLine(new OrderLine(...))
    # An overload is chosen, not smeared: neither call is ambiguous.
    assert all(not amb for t, _, amb in calls_from(result, f"{SVC}.CreateAsync") if "AddLine" in t)


def test_same_named_type_in_an_unreferenced_project_is_never_chosen(result):
    for e in result.edges:
        if e.kind in (EdgeKind.CALLS, EdgeKind.IMPORTS) and not e.source.startswith("src/Other"):
            assert not e.target.startswith("src/Other"), e


def test_partial_construction_links_the_main_declaration(result):
    assert ORDER in targets_from(result, f"{SVC}.CreateAsync")  # `new Order()`, no ctor
    assert "src/Lib/Models/Order.Totals.cs::Order" not in targets_from(result, f"{SVC}.CreateAsync")


def test_call_across_partial_declarations_of_one_type(result):
    assert f"{ORDER}.Recalculate" not in targets_from(result, f"{ORDER}.AddLine#1")
    assert "src/Lib/Models/Order.Totals.cs::Order.Recalculate" in targets_from(
        result, f"{ORDER}.AddLine#1"
    )


def test_overload_calling_overload_resolves_to_the_other_one(result):
    assert f"{ORDER}.AddLine#1" in targets_from(result, f"{ORDER}.AddLine#2")


def test_constructor_call_resolves_to_the_constructor(result):
    assert "src/Lib/Models/OrderLine.cs::OrderLine.OrderLine" in targets_from(
        result, f"{ORDER}.AddLine#2"
    )


def test_extension_method_on_a_library_type_resolves_into_the_repo(result):
    assert "src/Lib/Util/StringExtensions.cs::StringExtensions.Truncate" in targets_from(
        result, f"{SVC}.CreateAsync"
    )


def test_library_instance_method_wins_over_a_same_named_extension(result):
    # `text.Contains('a')` binds string.Contains; the repo's IEnumerable<char> extension loses.
    calls = calls_from(result, f"{SVC}.HasLetter")
    assert calls == {("external::string.Contains", True, False)}


def test_generic_constraint_gives_the_type_parameter_its_methods(result):
    assert "src/Lib/Util/Repo.cs::Entity.MarkSaved" in targets_from(
        result, "src/Lib/Util/Repo.cs::Repo`1.SaveAsync"
    )
    assert "src/Lib/Util/Repo.cs::Entity.MarkSaved" in targets_from(
        result, "src/Lib/Util/Repo.cs::Repo`2.Touch"
    )


def test_lambda_parameter_takes_the_collection_element_type(result):
    # `_lines.Sum(l => l.Price())`: `l` is an OrderLine.
    targets = targets_from(result, "src/Lib/Models/Order.Totals.cs::Order.ComputeTotal")
    assert "src/Lib/Models/OrderLine.cs::OrderLine.Price" in targets
    assert "external::List.Sum" in targets


def test_property_accessor_calls_are_attributed_to_the_accessor(result):
    assert "src/Lib/Models/Order.Totals.cs::Order.ComputeTotal" in targets_from(
        result, f"{ORDER}.Total#get"
    )


def test_pattern_variable_types_the_receiver(result):
    assert f"{ORDER}.Describe2" in targets_from(result, f"{SVC}.Describe")


def test_conditional_access_on_a_library_type_is_external(result):
    assert ("external::object.ToString", True, False) in calls_from(result, f"{SVC}.Describe")


def test_static_call_through_a_returned_type_chain(result):
    targets = targets_from(result, f"{SVC}.ShapeArea")  # Shape.Unit().Area()
    assert "src/Lib/Shapes/Shape.cs::Shape.Unit" in targets
    assert "src/Lib/Shapes/Shape.cs::Shape.Area" in targets


def test_base_call_and_constructor_chaining(result):
    assert "src/Lib/Shapes/Shape.cs::Shape.Describe" in targets_from(
        result, "src/Lib/Shapes/Shape.cs::Circle.Describe"
    )
    assert "src/Lib/Shapes/Shape.cs::Square.Square#2" in targets_from(
        result, "src/Lib/Shapes/Shape.cs::Square.Square#1"
    )


def test_bare_call_to_a_member_every_object_has(result):
    assert ("external::object.GetType", True, False) in calls_from(
        result, "src/Lib/Shapes/Shape.cs::Shape.Describe"
    )


def test_fully_qualified_library_call(result):
    assert ("external::Math.Sqrt", True, False) in calls_from(
        result, "src/Lib/Models/OrderLine.cs::Point.Distance"
    )


def test_active_preprocessor_branch_only(result):
    assert "src/Lib/Platform.cs::Platform.Modern" in targets_from(
        result, "src/Lib/Platform.cs::Platform.Name"
    )
    assert not any("Legacy" in n.id for n in result.nodes)


def test_async_as_an_identifier_does_not_lose_the_method(result):
    assert f"{SVC}.Log" in targets_from(result, f"{SVC}.Audit")
    assert f"{SVC}.Audit" in targets_from(result, f"{SVC}.CreateAsync")


def test_top_level_statements_attach_to_the_file(result):
    targets = targets_from(result, "src/App/Program.cs")
    assert f"{SVC}.CreateAsync" in targets
    assert f"{SVC}.OrderService" in targets
    assert "external::Console.WriteLine" in targets


def test_tests_project_sees_the_app_and_its_libraries(result):
    targets = targets_from(
        result, "tests/App.Tests/OrderServiceTests.cs::OrderServiceTests.Creates"
    )
    assert f"{SVC}.CreateAsync" in targets
    assert "external::Assert.NotNull" in targets


# -- imports -------------------------------------------------------------------------


def test_using_directives_become_import_edges(result):
    imports = {
        (e.target, e.external)
        for e in result.edges
        if e.kind == EdgeKind.IMPORTS and e.source == "src/App/Services/OrderService.cs"
    }
    assert ("external::System.Threading.Tasks", True) in imports
    assert ("src/Lib/Models", False) in imports  # a repo namespace -> its directory
    assert ("src/Other", False) not in imports  # not a visible project


def test_repo_namespace_imports_are_flagged_ambiguous(result):
    edge = next(
        e
        for e in result.edges
        if e.kind == EdgeKind.IMPORTS
        and e.source == "src/App/Services/OrderService.cs"
        and e.target == "src/Lib/Models"
    )
    assert edge.ambiguous  # a namespace spans files; the directory is a best representative


# -- honesty and determinism -------------------------------------------------------------


def test_unknown_receivers_are_reported_as_unresolved_not_guessed(result):
    unresolved = [e for e in result.edges if e.target.startswith("unresolved::")]
    assert all(e.ambiguous for e in unresolved)


def test_external_edges_are_flagged_external(result):
    assert all(e.external for e in result.edges if e.target.startswith("external::"))


def test_every_call_target_is_a_node_or_an_external_or_unresolved_marker(result):
    ids = {n.id for n in result.nodes}
    for e in result.edges:
        if e.kind == EdgeKind.CALLS:
            assert e.target in ids or e.target.startswith(("external::", "unresolved::")), e


def test_parsing_twice_gives_identical_output():
    first = parse_repository(FIXTURE, language="csharp")
    second = parse_repository(FIXTURE, language="csharp")
    assert [n.model_dump() for n in first.nodes] == [n.model_dump() for n in second.nodes]
    assert [e.model_dump() for e in first.edges] == [e.model_dump() for e in second.edges]


def test_two_parses_do_not_share_state():
    # `bind_root` hands every parse a fresh index; a second repo must not see the first's types.
    parse_repository(FIXTURE, language="csharp")
    other = FIXTURE / "src" / "Other"
    result = parse_repository(other, language="csharp")
    assert all("Lib" not in n.id for n in result.nodes)
