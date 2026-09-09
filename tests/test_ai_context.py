from pathlib import Path

from semantic_vision.ai.context import (
    _decorators_of,
    _render_ts_signature,
    assemble_code_health_context,
    assemble_context,
    assemble_file_context,
)
from semantic_vision.analysis.complexity import ComplexityScore
from semantic_vision.analysis.coverage import CoverageRiskScore
from semantic_vision.analysis.duplicates import DuplicateGroup
from semantic_vision.analysis.hotspots import HotspotScore
from semantic_vision.models import Node, NodeKind
from semantic_vision.parser.javascript_extractor import parse_tree
from semantic_vision.repo_parser import parse_repository
from semantic_vision.ts_locate import _build_index, find_def_node

FIXTURES = Path(__file__).parent / "fixtures"


def _parse(name: str):
    return parse_repository(str(FIXTURES / name))


def _ts_def(source: str, line: int, label: str):
    tree = parse_tree(source, "a.ts")
    index = _build_index(tree)
    node = find_def_node(index, line, label)
    assert node is not None, f"no def node found for {label!r} at line {line}"
    return node


def test_target_source_is_always_included():
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::Service.run")

    assert "def run(self, value: int) -> int:" in context.prompt
    assert "result = helper(value)" in context.prompt


def test_direct_callee_signature_is_included_and_external_call_excluded():
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::Service.run")

    assert "## Direct callees" in context.prompt
    callees_section = context.prompt.split("## Direct callees")[1].split("## ")[0]
    assert "- `def helper(x: int) -> int:`" in callees_section
    assert "abspath" not in callees_section
    assert "pass" not in callees_section


def test_direct_caller_signature_is_included():
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::Service.run")

    assert "## Direct callers" in context.prompt
    callers_section = context.prompt.split("## Direct callers")[1].split("## ")[0]
    assert "- `def execute(self, value: int) -> int:`" in callers_section
    assert "pass" not in callers_section


def test_parent_class_header_present_for_a_method():
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::Service.run")

    assert "## Parent class" in context.prompt
    parent_section = context.prompt.split("## Parent class")[1]
    assert "`class Service:`" in parent_section
    assert "pass" not in parent_section


def test_parent_class_header_absent_for_a_plain_function():
    result = _parse("simple_repo")

    context = assemble_context(result, "helpers.py::format_name")

    assert "## Parent class" not in context.prompt


def test_budget_truncation_drops_sections_but_keeps_target_source():
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::Service.run", max_tokens=5)

    assert "def run(self, value: int) -> int:" in context.prompt
    assert context.omitted
    assert "## Direct callees" not in context.prompt
    assert "## Direct callers" not in context.prompt
    assert "## Parent class" not in context.prompt


def test_no_callees_or_callers_sections_when_there_are_none():
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::standalone")

    assert "## Direct callees" not in context.prompt
    assert "## Direct callers" not in context.prompt
    assert context.omitted == []


def test_decorators_are_included_in_the_target_source_and_signature():
    """`FunctionDef.lineno` (and so `Node.line_start`) points at the `def`
    keyword, not the decorator line above it -- a naive line-range slice
    silently drops decorators from both the raw source and the
    reconstructed signature."""
    result = _parse("doc_context_repo")

    context = assemble_context(result, "app.py::standalone")

    target_block = context.prompt.split("## Target function")[1]
    assert "@logged" in target_block
    # The decorator appears both in the header signature and in the
    # fenced source block, not just incidentally once.
    assert target_block.count("@logged") == 2


# --- File-level docs (`assemble_file_context`) -- a different context
# shape entirely: no function body is ever inlined, only the file's path,
# its imports, and a rendered signature per top-level class/function (with
# class methods nested underneath), so a file's prompt size stays roughly
# constant regardless of the file's length.


def test_file_context_kind_is_file():
    result = _parse("doc_context_repo")

    context = assemble_file_context(result, "app.py")

    assert context.kind == "file"


def test_file_context_includes_file_path():
    result = _parse("doc_context_repo")

    context = assemble_file_context(result, "app.py")

    assert "## File" in context.prompt
    assert "`app.py`" in context.prompt


def test_file_context_includes_imports():
    result = _parse("doc_context_repo")

    context = assemble_file_context(result, "app.py")

    assert "## Imports" in context.prompt
    imports_section = context.prompt.split("## Imports")[1].split("## ")[0]
    assert "- `os`" in imports_section
    assert "- `helper`" in imports_section


def test_file_context_lists_top_level_defines_with_methods_nested_under_their_class():
    result = _parse("doc_context_repo")

    context = assemble_file_context(result, "app.py")

    assert "## Defines" in context.prompt
    defines_section = context.prompt.split("## Defines")[1]
    assert "- `class Service:`" in defines_section
    assert "  - `def run(self, value: int) -> int:`" in defines_section
    assert "  - `def execute(self, value: int) -> int:`" in defines_section
    assert "- `def logged(func):`" in defines_section
    # Decorators are stripped in this list, same as callee/caller
    # signatures -- it's a one-liner index, not the target's own header.
    assert "- `def standalone(value: int) -> int:`" in defines_section
    assert "@logged" not in defines_section


def test_file_context_never_inlines_a_function_body():
    result = _parse("doc_context_repo")

    context = assemble_file_context(result, "app.py")

    assert "result = helper(value)" not in context.prompt
    assert "os.path.abspath" not in context.prompt


def test_file_context_budget_truncation_keeps_file_header_drops_defines():
    result = _parse("doc_context_repo")

    context = assemble_file_context(result, "app.py", max_tokens=5)

    assert "`app.py`" in context.prompt
    assert context.omitted
    assert "## Defines" not in context.prompt


def test_file_context_budget_truncation_can_drop_only_some_defines_entries():
    """A budget big enough for the header and the first couple of
    entries, but not all of them, must keep the ones that fit and report
    the rest as omitted -- not an all-or-nothing drop of the whole
    section (that's the (looser) case `max_tokens=5` above exercises).
    Rather than hand-deriving the exact token budget for that middle
    state (fragile against `_approx_tokens`'s own formula), walk the
    budget up from clearly-too-small until it's reached -- deterministic
    for a fixed fixture, and decoupled from the token-counting internals.
    """
    result = _parse("doc_context_repo")
    full = assemble_file_context(result, "app.py")
    full_defines_section = full.prompt.split("## Defines")[1]

    candidates = (assemble_file_context(result, "app.py", max_tokens=n) for n in range(10, 500))
    partial = next(
        (
            context
            for context in candidates
            if "## Defines" in context.prompt
            and context.prompt.split("## Defines")[1] != full_defines_section
        ),
        None,
    )

    assert partial is not None, "expected some budget to keep only some Defines entries"
    assert any(o.startswith("Defines (") for o in partial.omitted)
    defines_section = partial.prompt.split("## Defines")[1]
    assert defines_section.strip() != ""


def test_file_context_nested_class_methods_are_not_lost():
    """A class nested inside another class -- not a function-local one --
    has its own `DEFINES` edge from the outer class, same shape as a
    regular method; its methods must still show up, not vanish because
    the recursion only used to go one level deep."""
    result = _parse("nested_class_repo")

    context = assemble_file_context(result, "app.py")

    defines_section = context.prompt.split("## Defines")[1]
    assert "- `class Outer:`" in defines_section
    assert "  - `class Inner:`" in defines_section
    assert "    - `def method(self):`" in defines_section


def test_file_context_import_label_strips_extension_for_a_whole_module_import():
    """`from helper import helper` (a named-symbol import) already
    resolves to a bare `helper` label. A plain `import helper` resolves
    instead to the `helper.py` FILE node -- without stripping the
    extension here, the same module would render inconsistently
    depending on which import form was used."""
    result = _parse("whole_module_import_repo")

    context = assemble_file_context(result, "app.py")

    imports_section = context.prompt.split("## Imports")[1]
    assert "- `helper`" in imports_section
    assert "helper.py" not in imports_section


def test_js_file_context_lists_top_level_defines_with_methods_nested_under_their_class():
    result = _parse_js("doc_context_repo_js")

    context = assemble_file_context(result, "app.ts")

    assert context.kind == "file"
    assert "`app.ts`" in context.prompt
    defines_section = context.prompt.split("## Defines")[1]
    assert "- `class Service`" in defines_section
    assert "  - `run(value: number): number`" in defines_section
    assert "  - `execute(value: number): number`" in defines_section
    assert "- `class Standalone`" in defines_section
    assert "  - `value(x: number): number`" in defines_section
    imports_section = context.prompt.split("## Imports")[1].split("## ")[0]
    assert "- `helper`" in imports_section
    assert "- `path`" in imports_section


# --- JS/TS (tree-sitter) -- mirrors the Python cases above one-for-one.
# JS/TS decorators can only apply to classes/methods/fields (not plain
# functions, unlike Python), so the decorator coverage below uses a
# decorated method instead of a decorated standalone function.


def _parse_js(name: str):
    return parse_repository(str(FIXTURES / name), language="javascript")


def test_js_target_source_and_signature_are_real_not_a_placeholder():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Service.run")

    assert "run(value: number): number" in context.prompt
    assert "const result = helper(value);" in context.prompt


def test_js_target_uses_a_language_aware_code_fence():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Service.run")

    assert "```typescript" in context.prompt
    assert "```python" not in context.prompt


def test_js_direct_callee_signature_is_included_and_external_call_excluded():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Service.run")

    assert "## Direct callees" in context.prompt
    callees_section = context.prompt.split("## Direct callees")[1].split("## ")[0]
    assert "- `function helper(x: number): number`" in callees_section
    assert "resolve" not in callees_section


def test_js_direct_caller_signature_is_included():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Service.run")

    assert "## Direct callers" in context.prompt
    callers_section = context.prompt.split("## Direct callers")[1].split("## ")[0]
    assert "- `execute(value: number): number`" in callers_section


def test_js_parent_class_header_present_for_a_method():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Service.run")

    assert "## Parent class" in context.prompt
    assert "`class Service`" in context.prompt.split("## Parent class")[1]


def test_js_parent_class_header_absent_for_a_plain_function():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "helper.ts::helper")

    assert "## Parent class" not in context.prompt


def test_js_no_callees_or_callers_sections_when_there_are_none():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Standalone.value")

    assert "## Direct callees" not in context.prompt
    assert "## Direct callers" not in context.prompt
    assert context.omitted == []


def test_js_method_decorator_is_included_in_target_source_and_signature_but_not_parent():
    result = _parse_js("doc_context_repo_js")

    context = assemble_context(result, "app.ts::Standalone.value")

    target_block = context.prompt.split("## Target function")[1].split("## Parent class")[0]
    assert target_block.count("@logged") == 2

    parent_block = context.prompt.split("## Parent class")[1]
    assert "@logged" not in parent_block
    assert "`class Standalone`" in parent_block


# --- Regression tests for bugs `test-critic` found in this milestone's
# first pass, verified independently against live tree-sitter output.


def test_js_anonymous_class_expression_with_heritage_does_not_duplicate_class_keyword():
    node = _ts_def("const Base = class extends Something {\n  m() {}\n};\n", 1, "Base")

    sig = _render_ts_signature(node, "Base", strip_decorators=True)
    assert sig == "class Base extends Something"


def test_js_anonymous_class_expression_bare_does_not_duplicate_class_keyword():
    node = _ts_def("const Base = class {\n  m() {}\n};\n", 1, "Base")

    assert _render_ts_signature(node, "Base", strip_decorators=True) == "class Base"


def test_js_exported_class_decorator_is_found_on_the_wrapping_export_statement():
    node = _ts_def("@Component()\nexport class Foo {}\n", 2, "Foo")

    assert [d.text.decode() for d in _decorators_of(node)] == ["@Component()"]
    assert _render_ts_signature(node, "Foo", strip_decorators=False) == "@Component()\nclass Foo"
    assert _render_ts_signature(node, "Foo", strip_decorators=True) == "class Foo"


def test_js_non_exported_class_decorator_still_works():
    # A non-exported decorated class's own span starts at the decorator
    # itself, so `RawClass.lineno` (and `Node.line_start`) point at the
    # decorator's line, not the `class` keyword's -- line 1 here, not 2.
    node = _ts_def("@Component()\nclass Bar {}\n", 1, "Bar")

    assert [d.text.decode() for d in _decorators_of(node)] == ["@Component()"]
    assert _render_ts_signature(node, "Bar", strip_decorators=False) == "@Component()\nclass Bar"
    assert _render_ts_signature(node, "Bar", strip_decorators=True) == "class Bar"


def test_js_var_and_let_declared_arrow_functions_keep_their_real_keyword():
    var_node = _ts_def("var oldStyle = (y) => y * 2;\n", 1, "oldStyle")
    let_node = _ts_def("let midStyle = (y) => y * 2;\n", 1, "midStyle")

    assert _render_ts_signature(var_node, "oldStyle", strip_decorators=True).startswith("var ")
    assert _render_ts_signature(let_node, "midStyle", strip_decorators=True).startswith("let ")


# --- Java (tree-sitter) -- mirrors the JS cases above. Java has no
# top-level functions (everything lives in a class), so the fixture uses
# a static-method "free function" analogue (`Helper.helper`) in place of
# JS's/Python's real module-level function.


def _parse_java(name: str):
    return parse_repository(str(FIXTURES / name), language="java")


def test_java_target_source_and_signature_are_real_not_a_placeholder():
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Service.run")

    assert "int run(int value)" in context.prompt
    assert "int result = Helper.helper(value);" in context.prompt


def test_java_target_uses_a_language_aware_code_fence():
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Service.run")

    assert "```java" in context.prompt
    assert "```python" not in context.prompt


def test_java_direct_callee_signature_is_included_and_external_call_excluded():
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Service.run")

    assert "## Direct callees" in context.prompt
    callees_section = context.prompt.split("## Direct callees")[1].split("## ")[0]
    assert "- `int helper(int x)`" in callees_section
    assert "requireNonNull" not in callees_section


def test_java_direct_caller_signature_is_included():
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Service.run")

    assert "## Direct callers" in context.prompt
    callers_section = context.prompt.split("## Direct callers")[1].split("## ")[0]
    assert "- `int execute(int value)`" in callers_section


def test_java_parent_class_header_present_for_a_method():
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Service.run")

    assert "## Parent class" in context.prompt
    assert "`class Service`" in context.prompt.split("## Parent class")[1]


def test_java_no_callees_or_callers_sections_when_there_are_none():
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Standalone.value")

    assert "## Direct callees" not in context.prompt
    assert "## Direct callers" not in context.prompt
    assert context.omitted == []


def test_java_annotation_is_included_in_target_source_and_signature_but_not_parent():
    """Unlike a JS decorator, a Java annotation is an ordinary child fully
    inside the method's own span (no `_decorators_of`-style span
    adjustment needed) -- this exercises that it still shows up in both
    the rendered signature and the fenced source, and is correctly
    excluded from the (unrelated) parent-class header."""
    result = _parse_java("doc_context_repo_java")

    context = assemble_context(result, "Service.java::Standalone.value")

    target_block = context.prompt.split("## Target function")[1].split("## Parent class")[0]
    assert target_block.count("@Deprecated") == 2

    parent_block = context.prompt.split("## Parent class")[1]
    assert "@Deprecated" not in parent_block
    assert "`class Standalone`" in parent_block


def test_java_file_context_lists_top_level_defines_with_methods_nested_under_their_class():
    result = _parse_java("doc_context_repo_java")

    context = assemble_file_context(result, "Service.java")

    assert context.kind == "file"
    assert "`Service.java`" in context.prompt
    defines_section = context.prompt.split("## Defines")[1]
    assert "- `class Service`" in defines_section
    assert "  - `int run(int value)`" in defines_section
    assert "  - `int execute(int value)`" in defines_section
    assert "- `class Helper`" in defines_section
    assert "  - `int helper(int x)`" in defines_section
    assert "- `class Standalone`" in defines_section
    assert "  - `int value(int x)`" in defines_section
    # The annotation is stripped in this list, same as callee/caller
    # signatures -- it's a one-liner index, not the target's own header.
    assert "@Deprecated" not in defines_section

    imports_section = context.prompt.split("## Imports")[1].split("## ")[0]
    assert "- `java.util.Objects`" in imports_section


def test_java_file_context_never_inlines_a_method_body():
    result = _parse_java("doc_context_repo_java")

    context = assemble_file_context(result, "Service.java")

    assert "Helper.helper(value)" not in context.prompt


def _fn_node(node_id: str, label: str) -> Node:
    return Node(
        id=node_id, kind=NodeKind.FUNCTION, label=label, file="app.py", line_start=1, line_end=2
    )


def test_code_health_context_is_kind_code_health():
    context = assemble_code_health_context({}, [], None, [], None, {})

    assert context.kind == "code_health"


def test_code_health_context_ranks_complexity_by_score_descending():
    nodes_by_id = {"app.py::a": _fn_node("app.py::a", "a"), "app.py::b": _fn_node("app.py::b", "b")}
    complexity_index = {
        "app.py::a": ComplexityScore(
            node_id="app.py::a", cyclomatic_complexity=3, call_chain_depth=0, has_nested_loops=False
        ),
        "app.py::b": ComplexityScore(
            node_id="app.py::b", cyclomatic_complexity=9, call_chain_depth=1, has_nested_loops=False
        ),
    }

    context = assemble_code_health_context(complexity_index, [], None, [], None, nodes_by_id)

    assert "## Top complexity risks" in context.prompt
    section = context.prompt.split("## Top complexity risks")[1].split("## ")[0]
    assert section.index("`b (app.py)`") < section.index("`a (app.py)`")


def test_code_health_context_reports_coverage_not_ingested_when_none():
    context = assemble_code_health_context({}, [], None, [], None, {})

    assert "## Coverage risk" in context.prompt
    assert "No coverage report ingested this session." in context.prompt


def test_code_health_context_includes_coverage_risk_scores_when_present():
    nodes_by_id = {"app.py::a": _fn_node("app.py::a", "a")}
    coverage_scores = [
        CoverageRiskScore(
            node_id="app.py::a",
            cyclomatic_complexity=5,
            blast_radius=2,
            coverage_ratio=0.25,
            risk_score=11.25,
        )
    ]

    context = assemble_code_health_context({}, [], coverage_scores, [], None, nodes_by_id)

    section = context.prompt.split("## Coverage risk")[1].split("## ")[0]
    assert "`a (app.py)`" in section
    assert "risk 11.2" in section
    assert "coverage 25%" in section


def test_code_health_context_distinguishes_no_coverage_data_from_zero_percent():
    nodes_by_id = {"app.py::a": _fn_node("app.py::a", "a")}
    coverage_scores = [
        CoverageRiskScore(
            node_id="app.py::a",
            cyclomatic_complexity=5,
            blast_radius=0,
            coverage_ratio=None,
            risk_score=5.0,
        )
    ]

    context = assemble_code_health_context({}, [], coverage_scores, [], None, nodes_by_id)

    section = context.prompt.split("## Coverage risk")[1].split("## ")[0]
    assert "coverage no data" in section


def test_code_health_context_distinguishes_ingested_but_nothing_scored_from_not_ingested():
    context = assemble_code_health_context({}, [], [], [], None, {})

    section = context.prompt.split("## Coverage risk")[1].split("## ")[0]
    assert "ingested, but nothing was scored" in section
    assert "No coverage report ingested" not in section


def test_code_health_context_reports_dependencies_not_scanned_when_none():
    context = assemble_code_health_context({}, [], None, [], None, {})

    assert "## Dependency vulnerabilities" in context.prompt
    assert "Not scanned this session." in context.prompt


def test_code_health_context_reports_clean_scan_for_an_empty_dependency_list():
    context = assemble_code_health_context({}, [], None, [], [], {})

    section = context.prompt.split("## Dependency vulnerabilities")[1]
    assert "no known vulnerabilities" in section
    assert "Not scanned" not in section


def test_code_health_context_includes_dependency_vulnerabilities_when_present():
    dependency_vulnerabilities = [("litellm", "1.60.0", ["GHSA-fake-1234", "PYSEC-fake-5678"])]

    context = assemble_code_health_context({}, [], None, [], dependency_vulnerabilities, {})

    section = context.prompt.split("## Dependency vulnerabilities")[1]
    assert "`litellm` 1.60.0" in section
    assert "GHSA-fake-1234" in section
    assert "2 known vulnerabilities" in section


def test_code_health_context_includes_duplicate_groups():
    nodes_by_id = {"app.py::a": _fn_node("app.py::a", "a"), "app.py::b": _fn_node("app.py::b", "b")}
    duplicate_groups = [DuplicateGroup(node_ids=["app.py::a", "app.py::b"], size=2)]

    context = assemble_code_health_context({}, [], None, duplicate_groups, None, nodes_by_id)

    assert "## Duplicate functions" in context.prompt
    section = context.prompt.split("## Duplicate functions")[1].split("## ")[0]
    assert "2 functions with identical structure" in section
    assert "`a (app.py)`" in section
    assert "`b (app.py)`" in section


def test_code_health_context_includes_hotspots_ranked_by_score():
    nodes_by_id = {"app.py::a": _fn_node("app.py::a", "a")}
    hotspot_scores = [
        HotspotScore(node_id="app.py::a", cyclomatic_complexity=4, change_count=5, hotspot_score=20)
    ]

    context = assemble_code_health_context({}, hotspot_scores, None, [], None, nodes_by_id)

    section = context.prompt.split("## Hotspots")[1].split("## ")[0]
    assert "`a (app.py)`" in section
    assert "hotspot score 20" in section


def test_code_health_context_drops_least_important_sections_when_over_budget():
    """Sections are added in priority order -- complexity, hotspots,
    coverage, duplicates, dependencies -- so a tight budget should drop
    from the *bottom* (dependencies first), not the top."""
    nodes_by_id = {"app.py::a": _fn_node("app.py::a", "a")}
    complexity_index = {
        "app.py::a": ComplexityScore(
            node_id="app.py::a", cyclomatic_complexity=9, call_chain_depth=1, has_nested_loops=False
        )
    }
    dependency_vulnerabilities = [("some-package", "1.0.0", ["GHSA-x"])]

    context = assemble_code_health_context(
        complexity_index, [], None, [], dependency_vulnerabilities, nodes_by_id, max_tokens=20
    )

    assert "## Top complexity risks" in context.prompt
    assert "## Dependency vulnerabilities" not in context.prompt
    assert "Dependency vulnerabilities" in context.omitted
    assert "requireNonNull" not in context.prompt
