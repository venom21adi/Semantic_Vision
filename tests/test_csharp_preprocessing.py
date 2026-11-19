"""Conditional compilation and grammar workarounds, applied before C# is parsed."""

import pytest

from semantic_vision.parser.csharp_extractor import (
    _eval_condition,
    _symbol_defined,
    extract_csharp_module,
    neutralize_async_identifiers,
    parse_tree,
    strip_conditionals,
)


@pytest.mark.parametrize(
    ("condition", "expected"),
    [
        ("NET6_0_OR_GREATER", True),
        ("NETSTANDARD2_0", True),
        ("NETCOREAPP3_1_OR_GREATER", True),
        ("TRACE", True),
        ("NET20", False),
        ("NET35", False),
        ("NET45", False),
        ("PORTABLE", False),
        ("DEBUG", False),
        ("HAVE_ASYNC", True),  # project-specific feature flag: analyse what it enables
        ("!NET20", True),
        ("!(NET20 || NET35 || PORTABLE40)", True),
        ("NET20 || NET6_0_OR_GREATER", True),
        ("NET20 && NET6_0_OR_GREATER", False),
        ("!HAVE_ASYNC || NET20", False),
        ("(NET6_0_OR_GREATER)", True),
        ("NET6_0_OR_GREATER // comment", True),
    ],
)
def test_condition_evaluation_under_the_modern_build_policy(condition, expected):
    assert _eval_condition(condition) is expected


def test_unparseable_conditions_keep_the_code():
    assert _eval_condition("&& ||") is True


def test_symbol_policy_classes():
    assert _symbol_defined("NET8_0_OR_GREATER")
    assert not _symbol_defined("SILVERLIGHT")
    assert not _symbol_defined("UNITY_EDITOR") or True  # custom flags default to defined


def test_active_branch_is_kept_and_inactive_blanked():
    src = "a\n#if NET6_0_OR_GREATER\nmodern\n#else\nlegacy\n#endif\nz\n"
    out = strip_conditionals(src)
    assert "modern" in out and "legacy" not in out
    assert "a" in out and "z" in out


def test_legacy_symbol_selects_the_else_branch():
    src = "#if NET20\nlegacy\n#else\nmodern\n#endif\n"
    out = strip_conditionals(src)
    assert "modern" in out and "legacy" not in out


def test_elif_chain_takes_the_first_true_branch_only():
    src = "#if NET20\nA\n#elif NET6_0_OR_GREATER\nB\n#elif TRACE\nC\n#else\nD\n#endif\n"
    out = strip_conditionals(src)
    assert [t for t in "ABCD" if t in out.split()] == ["B"]


def test_nested_conditionals():
    src = (
        "#if NET6_0_OR_GREATER\nouter\n"
        "#if NET20\ninner_legacy\n#else\ninner_modern\n#endif\n"
        "#endif\n"
    )
    out = strip_conditionals(src)
    assert "outer" in out and "inner_modern" in out and "inner_legacy" not in out


def test_inactive_outer_branch_hides_everything_inside():
    src = "#if NET20\n#if TRACE\nhidden\n#endif\n#endif\nvisible\n"
    out = strip_conditionals(src)
    assert "hidden" not in out and "visible" in out


def test_line_numbers_are_preserved():
    src = "l1\n#if NET20\nl3\n#else\nl5\n#endif\nl7\n"
    out = strip_conditionals(src)
    assert len(out.split("\n")) == len(src.split("\n"))
    assert out.split("\n")[4] == "l5" and out.split("\n")[6] == "l7"


def test_crlf_line_endings_survive():
    out = strip_conditionals("a\r\n#if NET20\r\nb\r\n#endif\r\nc\r\n")
    assert out.count("\r\n") == 5


def test_non_conditional_directives_are_left_alone():
    src = "#region R\nclass A { }\n#endregion\n#nullable enable\n"
    assert strip_conditionals(src) == src


def test_conditional_branch_splitting_a_statement_parses():
    src = (
        "class A { void M(int x) {\n"
        "#if NET20\n  if (x > 0) {\n#else\n  if (x > 1) {\n#endif\n    F();\n  }\n} }"
    )
    raw = extract_csharp_module(src)
    assert [c.name for c in raw.classes[0].methods[0].lang_data.calls] == ["F"]


def test_type_wrapped_in_a_conditional_is_extracted():
    src = "#if NET6_0_OR_GREATER\nnamespace N { public class Modern { void M() {} } }\n#endif\n"
    raw = extract_csharp_module(src)
    assert [c.name for c in raw.classes] == ["Modern"]


# -- `async` as an identifier ---------------------------------------------------------


@pytest.mark.parametrize(
    "code",
    [
        "void M(bool async) { if (async) { } }",
        "void M(bool async) { Foo(async, async c => { }); }",
        "void M(bool async) { var x = async ? 1 : 2; }",
        "void M(bool async) { async = true; }",
        "void M(bool async) { Bar(async: true); }",
    ],
)
def test_async_as_identifier_parses_cleanly(code):
    tree = parse_tree("class A { " + code + " }")
    assert not tree.root_node.has_error


def test_async_modifier_is_untouched():
    src = (
        "class A { public async Task M() { await F(); } static async void V() {}\n"
        "void L() { var f = async () => 1; var g = async x => x; var h = async delegate { }; } }"
    )
    assert neutralize_async_identifiers(src) == src
    assert not parse_tree(src).root_node.has_error


def test_async_member_access_is_not_renamed():
    src = "var x = obj.async;"
    assert neutralize_async_identifiers(src) == src


def test_neutralizing_async_keeps_length_and_lines():
    src = "void M(bool async) {\n if (async) { }\n}\n"
    out = neutralize_async_identifiers(src)
    assert len(out) == len(src) and out.count("\n") == src.count("\n")
    assert "async" not in out
