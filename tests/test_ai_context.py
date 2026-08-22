from pathlib import Path

from semantic_vision.ai.context import assemble_context
from semantic_vision.repo_parser import parse_repository

FIXTURES = Path(__file__).parent / "fixtures"


def _parse(name: str):
    return parse_repository(str(FIXTURES / name))


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
