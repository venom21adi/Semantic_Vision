from pathlib import Path

from semantic_vision.ai.context import _decorators_of, _render_ts_signature, assemble_context
from semantic_vision.parser.javascript_extractor import parse_tree
from semantic_vision.repo_parser import parse_repository
from semantic_vision.ts_locate import find_def_node

FIXTURES = Path(__file__).parent / "fixtures"


def _parse(name: str):
    return parse_repository(str(FIXTURES / name))


def _ts_def(source: str, line: int, label: str):
    tree = parse_tree(source, "a.ts")
    node = find_def_node(tree, line, label)
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
