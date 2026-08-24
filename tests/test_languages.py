import pytest

from semantic_vision.languages import LanguageAdapter, ParseSyntaxError, get_adapter, register
from semantic_vision.languages import registry as registry_module
from semantic_vision.languages.javascript import JAVASCRIPT_ADAPTER
from semantic_vision.languages.javascript import parse_file as js_parse_file
from semantic_vision.languages.python import PYTHON_ADAPTER, dotted_module_path, parse_file
from semantic_vision.parser.extractor import RawModule


def test_get_adapter_resolves_the_registered_python_adapter():
    assert get_adapter("python") is PYTHON_ADAPTER


def test_get_adapter_raises_for_an_unknown_language():
    with pytest.raises(ValueError, match="unknown-language"):
        get_adapter("unknown-language")


def test_register_adds_a_new_adapter_retrievable_by_its_language_id():
    adapter = LanguageAdapter(
        language_id="test-language",
        file_extensions=frozenset({".tst"}),
        parse_file=lambda source, rel_path: RawModule(rel_path=rel_path),
        dotted_module_path=lambda rel_path: rel_path,
        resolve_imports=lambda *args: None,
        resolve_calls=lambda *args: [],
    )
    register(adapter)
    try:
        assert get_adapter("test-language") is adapter
    finally:
        # Registration is a shared, module-level dict -- undo it so this
        # test doesn't leak state into any test run after it.
        del registry_module._ADAPTERS["test-language"]


def test_python_adapter_file_extensions_and_language_id():
    assert PYTHON_ADAPTER.language_id == "python"
    assert PYTHON_ADAPTER.file_extensions == frozenset({".py"})


def test_dotted_module_path_collapses_init_py_to_its_package_path():
    assert dotted_module_path("pkg/sub/__init__.py") == "pkg.sub"


def test_dotted_module_path_strips_py_suffix_for_a_regular_module():
    assert dotted_module_path("pkg/sub/mod.py") == "pkg.sub.mod"


def test_parse_file_extracts_a_raw_module_from_valid_source():
    raw = parse_file("def f():\n    pass\n", "a.py")

    assert raw.rel_path == "a.py"
    assert [func.name for func in raw.functions] == ["f"]


def test_parse_file_raises_parse_syntax_error_with_line_and_message():
    with pytest.raises(ParseSyntaxError) as exc_info:
        parse_file("def f(:\n    pass\n", "bad.py")

    assert exc_info.value.line == 1
    assert exc_info.value.message == str(exc_info.value)


def test_get_adapter_resolves_the_registered_javascript_adapter():
    assert get_adapter("javascript") is JAVASCRIPT_ADAPTER


def test_javascript_adapter_file_extensions_and_language_id():
    assert JAVASCRIPT_ADAPTER.language_id == "javascript"
    assert JAVASCRIPT_ADAPTER.file_extensions == frozenset(
        {".js", ".jsx", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx"}
    )


def test_js_parse_file_extracts_a_raw_module_from_valid_source():
    raw = js_parse_file("function f() {}\n", "a.ts")

    assert raw.rel_path == "a.ts"
    assert [func.name for func in raw.functions] == ["f"]


def test_js_parse_file_raises_parse_syntax_error_with_line_on_broken_source():
    with pytest.raises(ParseSyntaxError) as exc_info:
        js_parse_file("function f() {}\n\nclass C {\n", "bad.ts")

    assert exc_info.value.line == 3
    assert "bad.ts" in exc_info.value.message
