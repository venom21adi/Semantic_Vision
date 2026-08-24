from semantic_vision.parser.extractor import RawCall, RawImport, RawVariable
from semantic_vision.parser.javascript_extractor import (
    JAVASCRIPT,
    TSX,
    TYPESCRIPT,
    extract_javascript_module,
)


def extract(source: str, rel_path: str = "a.ts"):
    return extract_javascript_module(source, rel_path)


def test_named_imports_map_to_raw_import_rows():
    raw = extract('import { Foo, Bar as Baz } from "./local/module";')
    assert raw.imports == [
        RawImport(module="./local/module", name="Foo", asname=None, level=0, lineno=1),
        RawImport(module="./local/module", name="Bar", asname="Baz", level=0, lineno=1),
    ]


def test_default_import_uses_default_sentinel():
    raw = extract('import DefaultExport from "../other";')
    assert raw.imports == [
        RawImport(module="../other", name="default", asname="DefaultExport", level=0, lineno=1),
    ]


def test_namespace_import_uses_star_sentinel_with_asname():
    raw = extract('import * as ns from "namespace-pkg";')
    assert raw.imports == [
        RawImport(module="namespace-pkg", name="*", asname="ns", level=0, lineno=1),
    ]


def test_side_effect_only_import_has_no_clause():
    raw = extract('import "polyfill";')
    assert raw.imports == [
        RawImport(module=None, name="polyfill", asname=None, level=0, lineno=1),
    ]


def test_default_via_named_specifier_matches_default_import_shape():
    via_named = extract('import { default as X } from "m";').imports
    via_default = extract('import X from "m";').imports
    assert via_named == via_default == [
        RawImport(module="m", name="default", asname="X", level=0, lineno=1),
    ]


def test_combined_default_and_named_import_in_one_statement():
    raw = extract('import Foo, { bar } from "m";')
    assert raw.imports == [
        RawImport(module="m", name="default", asname="Foo", level=0, lineno=1),
        RawImport(module="m", name="bar", asname=None, level=0, lineno=1),
    ]


def test_top_level_function_declaration():
    raw = extract("function helper(name) {\n  return name.toUpperCase();\n}\n")
    assert len(raw.functions) == 1
    func = raw.functions[0]
    assert func.name == "helper"
    assert func.lineno == 1
    assert func.calls == [RawCall(dotted="name.toUpperCase", lineno=2)]


def test_arrow_function_assigned_to_const_becomes_named_function():
    raw = extract("const arrow = (x) => { return helper(x); };")
    assert len(raw.functions) == 1
    assert raw.functions[0].name == "arrow"
    assert raw.functions[0].calls == [RawCall(dotted="helper", lineno=1)]


def test_arrow_function_with_concise_body_still_collects_calls():
    raw = extract("const f = x => helper(x);")
    assert len(raw.functions) == 1
    func = raw.functions[0]
    assert func.name == "f"
    assert func.calls == [RawCall(dotted="helper", lineno=1)]


def test_class_expression_assigned_to_const_becomes_named_class():
    raw = extract("const C = class { greet() { return helper(); } };")
    assert len(raw.classes) == 1
    cls = raw.classes[0]
    assert cls.name == "C"
    assert [m.name for m in cls.methods] == ["greet"]
    assert cls.methods[0].calls == [RawCall(dotted="helper", lineno=1)]


def test_decorated_class_with_implements_clause_and_static_and_instance_methods():
    source = """
@Component({ selector: "app-root" })
class Greeting implements Greeter {
  private prefix: string = "Hello";

  greet(name: string): string {
    return this.prefix + name + helper(name);
  }

  static make(): Greeting {
    return new Greeting();
  }
}
"""
    raw = extract(source)
    assert len(raw.classes) == 1
    cls = raw.classes[0]
    assert cls.name == "Greeting"
    assert cls.decorator_calls == [RawCall(dotted="Component", lineno=2)]
    assert [a.name for a in cls.attributes] == ["prefix"]
    assert {m.name for m in cls.methods} == {"greet", "make"}

    greet = next(m for m in cls.methods if m.name == "greet")
    # `this.prefix` is a member access, not a call -- must not appear here.
    assert RawCall(dotted="this.prefix", lineno=7) not in greet.calls
    assert RawCall(dotted="helper", lineno=7) in greet.calls

    make = next(m for m in cls.methods if m.name == "make")
    assert make.calls == [RawCall(dotted="Greeting", lineno=11)]


def test_class_field_with_annotation_becomes_raw_variable_ts():
    raw = extract('class C { private prefix: string = "Hello"; }')
    assert raw.classes[0].attributes == [
        RawVariable(name="prefix", lineno=1, annotation="string"),
    ]


def test_class_field_with_annotation_becomes_raw_variable_js():
    raw = extract("class C { prefix = 5; }", rel_path="a.js")
    assert raw.classes[0].attributes == [
        RawVariable(name="prefix", lineno=1, annotation=None),
    ]


def test_member_expression_call_produces_dotted_name():
    raw = extract("function helper(name) {\n  return name.toUpperCase();\n}\n")
    assert raw.functions[0].calls == [RawCall(dotted="name.toUpperCase", lineno=2)]


def test_new_expression_with_bare_identifier_is_treated_as_a_call():
    raw = extract("function make() {\n  return new Greeting();\n}\n")
    assert raw.functions[0].calls == [RawCall(dotted="Greeting", lineno=2)]


def test_new_expression_with_member_expression_constructor_is_treated_as_a_call():
    raw = extract("function make() {\n  return new ns.Greeting();\n}\n")
    assert raw.functions[0].calls == [RawCall(dotted="ns.Greeting", lineno=2)]


def test_this_dotted_call_flattens_like_python_self():
    raw = extract("class C { greet() { return this.helper(); } }")
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="this.helper", lineno=1)]


def test_mixed_declarators_in_one_statement_classified_independently():
    raw = extract("let a = 1, b = () => { helper(); }, C = class { m() { other(); } };")
    assert [v.name for v in raw.variables] == ["a"]
    assert [f.name for f in raw.functions] == ["b"]
    assert raw.functions[0].calls == [RawCall(dotted="helper", lineno=1)]
    assert [c.name for c in raw.classes] == ["C"]
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="other", lineno=1)]


def test_anonymous_default_export_function_is_not_captured():
    raw = extract("export default function(x) {\n  return helper(x);\n}\n")
    assert raw.functions == []


def test_anonymous_default_export_class_is_not_captured():
    raw = extract("export default class {\n  greet() {}\n}\n")
    assert raw.classes == []


def test_named_default_export_function_is_captured_normally():
    raw = extract("export default function foo(x) {\n  return helper(x);\n}\n")
    assert len(raw.functions) == 1
    assert raw.functions[0].name == "foo"
    assert raw.functions[0].calls == [RawCall(dotted="helper", lineno=2)]


def test_named_default_export_class_is_captured_normally():
    raw = extract("export default class D {\n  greet() {}\n}\n")
    assert len(raw.classes) == 1
    assert raw.classes[0].name == "D"


def test_reexport_statement_is_not_treated_as_import_or_definition():
    raw = extract('export { Foo as Bar } from "./mod";')
    assert raw.imports == []
    assert raw.functions == []
    assert raw.classes == []


def test_module_level_call_expression_is_not_captured():
    raw = extract('const x = someCall();\nhelper();\n')
    assert raw.variables == [RawVariable(name="x", lineno=1, annotation=None)]
    assert raw.functions == []
    assert raw.classes == []


def test_function_guarded_by_if_statement_is_still_found():
    source = "if (typeof window === 'undefined') {\n  function polyfill() { return helper(); }\n}\n"
    raw = extract(source)
    assert len(raw.functions) == 1
    assert raw.functions[0].name == "polyfill"
    assert raw.functions[0].calls == [RawCall(dotted="helper", lineno=2)]


def test_jsx_sample_extracts_function_and_class_correctly_around_jsx():
    source = """
import { useState } from "react";

function Greeter(name) {
  const [count, setCount] = useState(0);
  return <div onClick={() => bump(count)}>{helper(name)}</div>;
}

class Widget {
  render() {
    return <span>{render(this.value)}</span>;
  }
}
"""
    raw = extract(source, rel_path="a.tsx")
    assert [i.name for i in raw.imports] == ["useState"]
    assert len(raw.functions) == 1
    greeter = raw.functions[0]
    assert greeter.name == "Greeter"
    assert RawCall(dotted="useState", lineno=5) in greeter.calls
    assert RawCall(dotted="bump", lineno=6) in greeter.calls
    assert RawCall(dotted="helper", lineno=6) in greeter.calls

    assert len(raw.classes) == 1
    widget = raw.classes[0]
    assert widget.name == "Widget"
    assert widget.methods[0].name == "render"
    assert RawCall(dotted="render", lineno=11) in widget.methods[0].calls
    assert RawCall(dotted="this.value", lineno=11) not in widget.methods[0].calls


def test_grammar_selected_by_rel_path_extension():
    js = extract_javascript_module("function f() {}", "a.js")
    ts = extract_javascript_module("function f(): void {}", "a.ts")
    tsx = extract_javascript_module("function f() { return <div/>; }", "a.tsx")
    assert [m.name for m in js.functions] == ["f"]
    assert [m.name for m in ts.functions] == ["f"]
    assert [m.name for m in tsx.functions] == ["f"]


def test_explicit_grammar_override_takes_precedence_over_extension():
    # `.js`-suffixed rel_path, but forced through the JSX-capable TSX
    # grammar -- confirms the override actually wins over the extension
    # lookup, not just that JSX happens to also work under `.js`.
    raw = extract_javascript_module("function f() { return <div/>; }", "a.js", grammar=TSX)
    assert [m.name for m in raw.functions] == ["f"]


def test_unknown_extension_raises():
    import pytest

    with pytest.raises(ValueError, match="No JS/TS grammar"):
        extract_javascript_module("x", "a.unknown")


def test_grammar_constants_are_distinct_languages():
    assert JAVASCRIPT is not TYPESCRIPT
    assert TYPESCRIPT is not TSX


def test_generator_function_declaration_is_captured():
    raw = extract("function* gen() {\n  helper();\n}\n")
    assert len(raw.functions) == 1
    assert raw.functions[0].name == "gen"
    assert raw.functions[0].calls == [RawCall(dotted="helper", lineno=2)]


def test_async_generator_function_declaration_is_captured():
    raw = extract("async function* agen() {\n  helper();\n}\n")
    assert len(raw.functions) == 1
    assert raw.functions[0].name == "agen"


def test_generator_function_expression_assigned_to_const_is_captured():
    raw = extract("const g = function* () {\n  helper();\n};\n")
    assert len(raw.functions) == 1
    assert raw.functions[0].name == "g"
    assert raw.functions[0].calls == [RawCall(dotted="helper", lineno=2)]


def test_abstract_class_is_captured():
    # `abstract greet(): void;` has no body -- a signature, not a
    # definition, same as an interface member -- correctly not captured
    # as a method; only `m`, which has a real implementation, is.
    raw = extract("abstract class C {\n  abstract greet(): void;\n  m() { helper(); }\n}\n")
    assert len(raw.classes) == 1
    cls = raw.classes[0]
    assert cls.name == "C"
    assert {m.name for m in cls.methods} == {"m"}


def test_method_level_decorator_is_captured():
    raw = extract("class C {\n  @Get()\n  findAll() { return helper(); }\n}\n")
    assert len(raw.classes) == 1
    method = raw.classes[0].methods[0]
    assert method.name == "findAll"
    assert method.decorator_calls == [RawCall(dotted="Get", lineno=2)]


def test_class_level_decorator_not_leaked_onto_first_method():
    raw = extract('@Component({})\nclass C {\n  greet() {}\n}\n')
    assert raw.classes[0].decorator_calls == [RawCall(dotted="Component", lineno=1)]
    assert raw.classes[0].methods[0].decorator_calls == []


def test_class_nested_inside_arrow_function_closure_is_found():
    raw = extract("const outer = () => {\n  class Deep { m() { helper(); } }\n};\n")
    assert len(raw.functions) == 1
    nested = raw.functions[0].nested_classes[0]
    assert nested.name == "Deep"
    assert nested.methods[0].calls == [RawCall(dotted="helper", lineno=2)]


def test_class_nested_inside_doubly_nested_arrow_closure_is_found():
    raw = extract("function outer() {\n  const inner = () => {\n    class Deep {}\n  };\n}\n")
    assert raw.functions[0].nested_classes[0].name == "Deep"
