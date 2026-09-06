from semantic_vision.parser.extractor import RawCall, RawImport
from semantic_vision.parser.java_extractor import (
    extract_java_module,
    first_error_line,
    parse_tree,
)


def extract(source: str, rel_path: str = "com/example/A.java"):
    return extract_java_module(source, rel_path)


def test_plain_type_import():
    raw = extract("import com.example.util.Formatter;\nclass A {}\n")
    assert raw.imports == [
        RawImport(module="com.example.util", name="Formatter", asname=None, level=0, lineno=1)
    ]


def test_wildcard_import_uses_star_sentinel():
    raw = extract("import com.example.util.*;\nclass A {}\n")
    assert raw.imports == [
        RawImport(module="com.example.util", name="*", asname=None, level=0, lineno=1)
    ]


def test_static_member_import_uses_level_as_static_marker():
    raw = extract("import static com.example.util.Formatter.format;\nclass A {}\n")
    assert raw.imports == [
        RawImport(
            module="com.example.util.Formatter", name="format", asname=None, level=1, lineno=1
        )
    ]


def test_static_wildcard_import():
    raw = extract("import static com.example.util.Formatter.*;\nclass A {}\n")
    assert raw.imports == [
        RawImport(module="com.example.util.Formatter", name="*", asname=None, level=1, lineno=1)
    ]


def test_single_segment_import_has_no_package():
    raw = extract("import Foo;\nclass A {}\n")
    assert raw.imports == [RawImport(module=None, name="Foo", asname=None, level=0, lineno=1)]


def test_class_with_method_and_field():
    source = """
public class Widget {
    private int count;

    public int total() {
        return count;
    }
}
"""
    raw = extract(source)
    assert len(raw.classes) == 1
    cls = raw.classes[0]
    assert cls.name == "Widget"
    assert [a.name for a in cls.attributes] == ["count"]
    assert [m.name for m in cls.methods] == ["total"]


def test_multi_declarator_field_produces_multiple_attributes():
    raw = extract("class A {\n    private int a, b;\n}\n")
    assert [(a.name, a.annotation) for a in raw.classes[0].attributes] == [
        ("a", "int"),
        ("b", "int"),
    ]


def test_interface_and_enum_map_to_raw_class():
    source = (
        "interface Shape {\n    double area();\n}\n\n"
        "enum Status {\n    OK, FAIL;\n\n    boolean isOk() { return this == OK; }\n}\n"
    )
    raw = extract(source)
    assert {c.name for c in raw.classes} == {"Shape", "Status"}
    shape = next(c for c in raw.classes if c.name == "Shape")
    assert [m.name for m in shape.methods] == ["area"]
    status = next(c for c in raw.classes if c.name == "Status")
    assert [m.name for m in status.methods] == ["isOk"]


def test_constructor_is_extracted_as_a_method_named_after_the_class():
    raw = extract("class Widget {\n    public Widget(int x) {\n        this.setup();\n    }\n}\n")
    cls = raw.classes[0]
    assert [m.name for m in cls.methods] == ["Widget"]
    assert cls.methods[0].calls == [RawCall(dotted="this.setup", lineno=3)]


def test_bare_call_normalizes_to_implicit_this():
    raw = extract("class A {\n    void m() {\n        doStuff();\n    }\n}\n")
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="this.doStuff", lineno=3)]


def test_explicit_this_call():
    raw = extract("class A {\n    void m() {\n        this.doStuff();\n    }\n}\n")
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="this.doStuff", lineno=3)]


def test_qualified_field_access_call():
    raw = extract("class A {\n    void m() {\n        System.out.println(\"x\");\n    }\n}\n")
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="System.out.println", lineno=3)]


def test_constructor_call_maps_to_type_name():
    raw = extract("class A {\n    void m() {\n        Formatter f = new Formatter();\n    }\n}\n")
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="Formatter", lineno=3)]


def test_qualified_constructor_call_uses_full_dotted_type():
    raw = extract("class A {\n    void m() {\n        new java.util.ArrayList();\n    }\n}\n")
    assert raw.classes[0].methods[0].calls == [RawCall(dotted="java.util.ArrayList", lineno=3)]


def test_local_class_inside_method_body_is_captured_as_nested():
    source = """
class Outer {
    void m() {
        class Local {
            void inner() {}
        }
    }
}
"""
    raw = extract(source)
    outer = raw.classes[0]
    method = outer.methods[0]
    assert [c.name for c in method.nested_classes] == ["Local"]


def test_nested_class_inside_class_body_is_captured():
    source = """
class Outer {
    class Inner {
        void m() {}
    }
}
"""
    raw = extract(source)
    outer = raw.classes[0]
    assert [c.name for c in outer.nested_classes] == ["Inner"]
    assert outer.methods == []


def test_no_top_level_functions_or_module_variables():
    raw = extract("package com.example;\n\npublic class A {\n    void m() {}\n}\n")
    assert raw.functions == []
    assert raw.variables == []


def test_syntax_error_is_detected_via_has_error():
    tree = parse_tree("public class {{{ not java", "Bad.java")
    assert tree.root_node.has_error is True
    assert first_error_line(tree) is not None


def test_valid_source_has_no_error():
    tree = parse_tree("class A {}\n", "A.java")
    assert tree.root_node.has_error is False
    assert first_error_line(tree) is None
