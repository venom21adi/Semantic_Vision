"""Extraction facts for C#: what `parser/csharp_extractor.py` records per file.

Purely syntactic, like every extractor: no cross-file resolution here (that is
`test_csharp_resolution.py`)."""

from semantic_vision.parser.csharp_extractor import (
    CsExpr,
    extract_csharp_module,
    parse_tree,
)


def module(source: str, rel_path: str = "A.cs"):
    return extract_csharp_module(source, rel_path)


def cls(source: str, name: str | None = None):
    raw = module(source)
    return raw.classes[0] if name is None else next(c for c in raw.classes if c.name == name)


def method(source: str, class_name: str, method_name: str):
    c = cls(source, class_name)
    return next(m for m in c.methods if m.name == method_name)


# -- namespaces, usings, type kinds --------------------------------------------------


def test_block_and_file_scoped_namespaces():
    block = cls("namespace A.B { class X { } }")
    assert block.lang_data.namespace == "A.B"
    scoped = cls("namespace A.B;\nclass X { }")
    assert scoped.lang_data.namespace == "A.B"


def test_nested_namespaces_join():
    c = cls("namespace A { namespace B { class X { } } }")
    assert c.lang_data.namespace == "A.B"


def test_types_after_file_scoped_namespace_belong_to_it():
    raw = module("namespace N;\nclass A { }\nclass B { }")
    assert [c.lang_data.namespace for c in raw.classes] == ["N", "N"]


def test_using_directives_namespace_static_alias_global():
    raw = module(
        "global using System;\n"
        "using System.Text;\n"
        "using static System.Math;\n"
        "using Sb = System.Text.StringBuilder;\n"
        "class X { }"
    )
    by_target = {u.target: u for u in raw.classes[0].lang_data.usings}
    assert by_target["System"].is_global
    assert by_target["System.Text"].kind == "namespace"
    assert by_target["System.Math"].kind == "static"
    alias = by_target["System.Text.StringBuilder"]
    assert (alias.kind, alias.alias) == ("alias", "Sb")
    assert [u.target for u in raw.lang_data.global_usings] == ["System"]


def test_usings_inside_a_namespace_apply_only_there():
    raw = module("using A;\nnamespace N { using B; class In { } }\nclass Out { }")
    inside = next(c for c in raw.classes if c.name == "In")
    outside = next(c for c in raw.classes if c.name == "Out")
    assert {u.target for u in inside.lang_data.usings} == {"A", "B"}
    assert {u.target for u in outside.lang_data.usings} == {"A"}


def test_type_kinds_and_partial_flag():
    raw = module(
        "partial class A { } struct S { } interface I { } enum E { X, Y } record R(int V);"
    )
    kinds = {c.name: c.lang_data.kind for c in raw.classes}
    assert kinds == {"A": "class", "S": "struct", "I": "interface", "E": "enum", "R": "record"}
    assert raw.classes[0].lang_data.is_partial


def test_bases_members_and_enum_members():
    c = cls("class D : B, IFoo { int f; string P { get; set; } }")
    assert c.lang_data.bases == ["B", "IFoo"]
    assert c.lang_data.members == {"f": "int", "P": "string"}
    e = cls("enum E { A, B = 2 }")
    assert e.lang_data.members == {"A": "E", "B": "E"}


def test_record_primary_constructor_parameters_become_members():
    c = cls("record R(int X, string Name);")
    assert c.lang_data.members == {"X": "int", "Name": "string"}


def test_generic_arity_siblings_get_distinct_graph_names():
    raw = module("class T<A> { } class T<A, B> { } class T { }")
    assert sorted(c.name for c in raw.classes) == ["T", "T`1", "T`2"]


def test_generic_constraints_are_recorded():
    c = cls("class R<T, U> where T : Entity, IFoo where U : class { }")
    assert c.lang_data.constraints == {"T": ("Entity", "IFoo"), "U": ()}
    assert c.lang_data.own_type_params == ("T", "U")


# -- members -------------------------------------------------------------------------


def test_overloads_get_stable_indices():
    c = cls("class A { void F() {} void F(int x) {} void G() {} }")
    assert [(m.name, m.overload_index) for m in c.methods] == [("F", 1), ("F", 2), ("G", None)]


def test_constructors_are_named_after_the_class_and_overloaded():
    c = cls("class A { A() {} A(int x) {} }")
    assert [(m.name, m.overload_index) for m in c.methods] == [("A", 1), ("A", 2)]
    assert all(m.lang_data.kind == "ctor" for m in c.methods)


def test_constructor_initializer_is_a_call():
    m = method("class A : B { A(int x) : base(x, 1) {} }", "A", "A")
    init = [c for c in m.lang_data.calls if c.kind == "init"][0]
    assert (init.name, init.arity) == ("base", 2)


def test_auto_property_is_a_member_not_a_function():
    c = cls("class A { public int X { get; set; } }")
    assert c.methods == []
    assert c.lang_data.members["X"] == "int"


def test_property_with_bodies_gets_one_function_per_accessor():
    c = cls("class A { int _v; public int X { get { return _v; } set { _v = value; } } }")
    assert [(m.name, m.accessor_kind) for m in c.methods] == [("X", "get"), ("X", "set")]


def test_expression_bodied_property_is_a_getter_function():
    c = cls("class A { public int X => Compute(); int Compute() => 1; }")
    prop = next(m for m in c.methods if m.name == "X")
    assert prop.accessor_kind == "get"
    assert [call.name for call in prop.lang_data.calls] == ["Compute"]


def test_accessors_and_operators_are_flagged_as_implicitly_invoked():
    c = cls("class A { int X => 1; public static A operator +(A a, A b) => a; }")
    assert all(m.has_decorators for m in c.methods)
    assert [m.name for m in c.methods] == ["X", "operator +"]


def test_attributes_set_has_decorators():
    c = cls("class A { [Fact] void T() {} void U() {} }")
    flags = {m.name: m.has_decorators for m in c.methods}
    assert flags == {"T": True, "U": False}


def test_override_is_flagged():
    c = cls('class A { public override string ToString() => ""; void P() {} }')
    flags = {m.name: m.has_decorators for m in c.methods}
    assert flags == {"ToString": True, "P": False}


def test_extension_method_and_arity_bounds():
    m = method(
        "static class E { static int F(this string s, int a, int b = 2, params int[] rest) => 0; }",
        "E",
        "F",
    )
    d = m.lang_data
    assert d.is_extension
    assert [p.name for p in d.params] == ["s", "a", "b", "rest"]
    assert [p.is_params for p in d.params] == [False, False, False, True]
    assert d.min_arity == 2  # `this` + `a`
    assert d.max_arity is None  # `params` makes it unbounded


def test_field_initializer_calls_belong_to_the_class():
    c = cls("class A { static readonly X Cache = Make(); static X Make() => null; }")
    assert [call.name for call in c.lang_data.init_data.calls] == ["Make"]


def test_top_level_statements_are_collected_on_the_module():
    raw = module("var x = Foo();\nBar(x);\n")
    names = [c.name for c in raw.lang_data.top_level.calls]
    assert names == ["Foo", "Bar"]


# -- call sites ---------------------------------------------------------------------


def calls(source: str, class_name: str = "A", method_name: str = "M"):
    return method(source, class_name, method_name).lang_data.calls


def test_bare_and_qualified_calls():
    cs = calls("class A { void M() { F(); this.G(); base.H(); X.Y(); } }")
    assert [(c.name, c.receiver.kind if c.receiver else None) for c in cs] == [
        ("F", None),
        ("G", "this"),
        ("H", "base"),
        ("Y", "name"),
    ]


def test_receiver_chain_is_kept_structurally():
    outer, inner_site = calls("class A { void M() { a.B().C(1); } }")
    assert outer.name == "C" and outer.arity == 1
    inner = outer.receiver
    assert (inner.kind, inner.name) == ("call", "B")
    assert inner.inner == CsExpr("name", name="a")
    assert inner_site.name == "B"  # the inner call is also a call site of its own


def test_conditional_access_reads_like_member_access():
    (call,) = calls("class A { void M() { a?.b?.C(); } }")
    assert call.name == "C"
    assert (call.receiver.kind, call.receiver.name) == ("member", "b")
    assert call.receiver.inner == CsExpr("name", name="a")


def test_generic_calls_keep_type_arguments():
    (call,) = calls("class A { void M() { Foo<int, string>(); } }")
    assert (call.name, call.type_args) == ("Foo", ("int", "string"))


def test_object_creation_is_a_call():
    cs = calls("class A { void M() { var o = new Foo(1, 2); } }")
    (new,) = [c for c in cs if c.kind == "new"]
    assert (new.type_text, new.arity) == ("Foo", 2)


def test_nameof_is_not_a_call():
    assert calls("class A { void M() { var n = nameof(x); } }") == []


def test_arguments_are_described_for_overload_selection():
    call = next(
        c for c in calls('class A { void M() { F(1, "s", null, x, new B()); } }') if c.name == "F"
    )
    kinds = [(a.kind, a.type_text or a.name) for a in call.args]
    assert kinds == [
        ("literal", "int"),
        ("literal", "string"),
        ("literal", "null"),
        ("name", "x"),
        ("new", "B"),
    ]


def test_named_arguments_disable_positional_matching():
    (call,) = calls("class A { void M() { F(1, y: 2); } }")
    assert call.args is None
    assert call.arity == 2


def test_calls_inside_lambdas_and_local_functions_belong_to_the_method():
    cs = calls("class A { void M() { void L() { Inner(); } Run(() => Lam()); } }")
    assert sorted(c.name for c in cs) == ["Inner", "Lam", "Run"]


def test_local_functions_are_recorded_by_name():
    md = method("class A { void M() { int L() => 1; } }", "A", "M").lang_data
    assert md.local_functions == {"L"}


def test_calls_are_in_document_order_outer_before_inner():
    cs = calls("class A { void M() { Outer(Inner()); } }")
    assert [c.name for c in cs] == ["Outer", "Inner"]


# -- local type evidence ------------------------------------------------------------


def locals_of(source: str):
    return method(source, "A", "M").lang_data.locals


def test_declared_parameter_and_local_types():
    loc = locals_of("class A { void M(int p) { string s = null; } }")
    assert loc["p"].type_text == "int"
    assert loc["s"].type_text == "string"


def test_var_records_the_initializer_as_evidence():
    loc = locals_of("class A { void M() { var x = new Foo(); var y = Make(); } }")
    assert loc["x"].type_text is None and loc["x"].init.kind == "new"
    assert loc["y"].init.kind == "call"


def test_foreach_var_records_the_element_of_the_collection():
    loc = locals_of("class A { void M(List<Foo> xs) { foreach (var x in xs) { } } }")
    assert loc["x"].init.kind == "elem"
    assert loc["x"].init.inner == CsExpr("name", name="xs")


def test_pattern_and_catch_and_out_variables():
    loc = locals_of(
        "class A { void M(object o) { if (o is Foo f) {} try {} catch (IOException ex) {} "
        "TryGet(out Bar b); TryGet(out var c); } }"
    )
    assert loc["f"].type_text == "Foo"
    assert loc["ex"].type_text == "IOException"
    assert loc["b"].type_text == "Bar"
    assert loc["c"].type_text is None


def test_lambda_parameter_takes_the_element_type_of_its_receiver():
    loc = locals_of("class A { void M(List<Foo> xs) { xs.Where(x => x.Ok()); } }")
    ev = loc["x"].init
    assert (ev.kind, ev.name) == ("lambda_elem", "Where")
    assert ev.inner == CsExpr("name", name="xs")


def test_same_name_with_different_evidence_collapses_to_unknown():
    loc = locals_of("class A { void M() { { Foo x = null; } { Bar x = null; } } }")
    assert loc["x"].type_text is None and loc["x"].init is None


# -- robustness ---------------------------------------------------------------------


def test_syntax_errors_still_yield_what_can_be_extracted():
    raw = module("class Good { void M() { F(); } }\nclass Bad { void N( { } }")
    assert any(c.name == "Good" for c in raw.classes)


def test_bom_is_ignored():
    raw = module("﻿namespace N { class A { } }")
    assert raw.classes[0].lang_data.namespace == "N"


def test_parse_tree_returns_a_tree_for_empty_source():
    assert parse_tree("").root_node is not None
