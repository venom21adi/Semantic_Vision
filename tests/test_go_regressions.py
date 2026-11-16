"""Regression tests for the wrong-answer bugs the `test-critic` review found
in Go support. Each test names the bug it pins."""

from pathlib import Path

from semantic_vision.analysis.dead_code import find_dead_code_candidates
from semantic_vision.analysis.impact import build_reverse_caller_index
from semantic_vision.flowchart.cfg import build_flowchart
from semantic_vision.models import EdgeKind
from semantic_vision.repo_parser import parse_repository
from semantic_vision.resolver.go_imports import find_go_modules, local_package_dir


def make_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    for rel, text in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return tmp_path


def calls(result) -> set[tuple[str, str]]:
    return {(e.source, e.target) for e in result.edges if e.kind == EdgeKind.CALLS}


def flow_edges(chart) -> set[tuple[str, str, str | None]]:
    labels = {n.id: n.label for n in chart.nodes}
    return {(labels[e.source], labels[e.target], e.label) for e in chart.edges}


# 1. an empty `case` must not flow into the next case's body ----------------


def test_empty_case_without_fallthrough_exits_the_switch(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc F(i int) {\n\tswitch {\n\tcase i == 3:\n"
            "\tdefault:\n\t\tdo()\n\t}\n\tafter()\n}\n"
        },
    )
    chart = build_flowchart(parse_repository(repo, language="go"), "a.go::F")
    found = flow_edges(chart)
    assert ("switch", "do()", "default") in found
    assert ("switch", "do()", "case i == 3") not in found
    # the empty case goes straight to what follows the switch
    assert ("switch", "after()", "case i == 3") in found


def test_fallthrough_chains_through_an_empty_case(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc F(i int) {\n\tswitch i {\n\tcase 1:\n\t\tfallthrough\n"
            "\tcase 2:\n\t\tfallthrough\n\tcase 3:\n\t\tdo()\n\t}\n}\n"
        },
    )
    found = flow_edges(build_flowchart(parse_repository(repo, language="go"), "a.go::F"))
    assert ("switch i", "do()", "case 1") in found
    assert ("switch i", "do()", "case 2") in found
    assert ("switch i", "do()", "case 3") in found


# 2. labeled non-loop statements keep their body ----------------------------


def test_labeled_switch_keeps_branches_and_labeled_break_targets_it(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc F(x int) {\nL:\n\tswitch x {\n\tcase 1:\n\t\tfor {\n"
            "\t\t\tbreak L\n\t\t}\n\tdefault:\n\t\tother()\n\t}\n\tafter()\n}\n"
        },
    )
    chart = build_flowchart(parse_repository(repo, language="go"), "a.go::F")
    labels = {n.label for n in chart.nodes}
    assert "switch x" in labels and "other()" in labels
    assert not any(label.startswith("L:") for label in labels)
    # `break L` leaves the *switch*, to the statement after it
    assert ("break L", "after()", None) in flow_edges(chart)


def test_labeled_select_is_not_collapsed(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc F(c chan int) {\nL:\n\tselect {\n\tcase <-c:\n"
            "\t\tbreak L\n\t}\n}\n"
        },
    )
    chart = build_flowchart(parse_repository(repo, language="go"), "a.go::F")
    assert any(n.label == "select" for n in chart.nodes)


# 3. a local that shadows the receiver ---------------------------------------


def test_shadowed_receiver_is_not_rewritten_to_this(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype Server struct{}\ntype Other struct{}\n\n"
            "func (s *Server) Run() {}\nfunc (o *Other) Run() {}\n\n"
            "func (s *Server) Shadow() {\n\ts := &Other{}\n\ts.Run()\n}\n\n"
            "func (s *Server) Plain() {\n\ts.Run()\n}\n"
        },
    )
    found = calls(parse_repository(repo, language="go"))
    # `s` was redeclared, so the call must not be aimed at Server.Run
    assert ("a.go::Server.Shadow", "a.go::Server.Run") not in found
    # with no shadowing the receiver rewrite still works
    assert ("a.go::Server.Plain", "a.go::Server.Run") in found


# 4. a type name resolves to the real declaration, not a methods-only stub ----


def test_cross_file_type_reference_prefers_the_real_declaration(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a_methods.go": "package p\n\nfunc (s *Server) Run() {}\n",
            "server.go": "package p\n\ntype Server struct{}\n",
            "c.go": "package p\n\nfunc C() {\n\t_ = Server{}\n}\n",
        },
    )
    found = calls(parse_repository(repo, language="go"))
    assert ("c.go::C", "server.go::Server") in found
    assert ("c.go::C", "a_methods.go::Server") not in found


# 5. import resolution without / above a go.mod ----------------------------


def test_without_go_mod_a_single_segment_dir_never_matches_a_third_party_path():
    dirs = {"util", "api", "internal/util"}
    assert local_package_dir("github.com/stripe/stripe-go/util", {}, dirs) is None
    assert local_package_dir("k8s.io/apimachinery/pkg/api", {}, dirs) is None
    assert local_package_dir("example.com/app/internal/util", {}, dirs) == "internal/util"


def test_go_mod_in_a_parent_directory_is_found(tmp_path):
    (tmp_path / "go.mod").write_text("module example.com/mod\n", encoding="utf-8")
    sub = tmp_path / "pkg" / "svc"
    sub.mkdir(parents=True)
    assert find_go_modules(sub) == {"": "example.com/mod/pkg/svc"}
    assert find_go_modules(tmp_path) == {"": "example.com/mod"}


def test_subdirectory_selected_inside_a_module_resolves_local_imports(tmp_path):
    root = make_repo(
        tmp_path,
        {
            "go.mod": "module example.com/mod\n",
            "svc/a.go": 'package svc\n\nimport "example.com/mod/svc/util"\n\n'
            "func A() {\n\tutil.Do()\n}\n",
            "svc/util/u.go": "package util\n\nfunc Do() {}\n",
        },
    )
    result = parse_repository(root / "svc", language="go")
    assert ("a.go::A", "util/u.go::Do") in calls(result)


def test_a_file_never_imports_its_own_package(tmp_path):
    root = make_repo(
        tmp_path,
        {
            "go.mod": "module example.com/mod\n",
            "api/a.go": 'package api\n\nimport "example.com/mod/api"\n\nfunc A() {}\n',
        },
    )
    result = parse_repository(root, language="go")
    assert not any(
        e.kind == EdgeKind.IMPORTS and e.source == "api/a.go" and e.target == "api"
        for e in result.edges
    )


# 6. function values count as references; interface methods aren't dead ------


def test_function_values_are_references_not_dead_code(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nimport \"net/http\"\n\n"
            "type Cmd struct{ Run func() }\n\n"
            "func viaCb(w http.ResponseWriter, r *http.Request) {}\n"
            "func keyed() {}\nfunc inSlice() {}\nfunc unused() {}\n\n"
            "type Server struct{}\n\nfunc (s *Server) handle() {}\nfunc (s *Server) Start() {\n"
            '\thttp.HandleFunc("/", viaCb)\n\t_ = &Cmd{Run: keyed}\n'
            "\t_ = []func(){inSlice}\n\thttp.HandleFunc(\"/h\", s.handle)\n\tlocal := 1\n"
            "\t_ = fmt(local)\n}\n\nfunc (s *Server) String() string { return \"\" }\n"
        },
    )
    result = parse_repository(repo, language="go")
    found = calls(result)
    assert ("a.go::Server.Start", "a.go::viaCb") in found
    assert ("a.go::Server.Start", "a.go::keyed") in found
    assert ("a.go::Server.Start", "a.go::inSlice") in found
    assert ("a.go::Server.Start", "a.go::Server.handle") in found
    # plain variables passed as args don't become noise edges
    assert not any(t.startswith("unresolved::ref:") for _s, t in found)
    assert not any(t == "unresolved::local" for _s, t in found)

    reverse = build_reverse_caller_index(result.edges)
    dead = {
        c.node_id.split("::")[1]
        for c in find_dead_code_candidates(result.nodes, reverse, root=repo)
    }
    assert "unused" in dead
    assert not dead & {"viaCb", "keyed", "inSlice", "Server.handle"}
    assert "Server.String" not in dead  # exported method: may satisfy an interface


# Second review round ----------------------------------------------------------


def test_local_variable_or_parameter_named_like_a_function_is_not_a_reference(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc h() {}\nfunc handler() {}\n\n"
            "func F() {\n\th := 1\n\tuse(h)\n}\n\n"
            "func G(h int) {\n\tuse(h)\n}\n\n"
            "func Reg(handler func()) {\n\trun(handler)\n\t_ = Point{h: handler}\n}\n"
        },
    )
    found = calls(parse_repository(repo, language="go"))
    assert ("a.go::F", "a.go::h") not in found
    assert ("a.go::G", "a.go::h") not in found
    assert ("a.go::Reg", "a.go::handler") not in found


def test_function_values_in_return_assignment_send_and_var_are_references(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc ret() {}\nfunc asg() {}\nfunc snd() {}\nfunc vr() {}\n\n"
            "func F(ch chan func()) func() {\n\tf := asg\n\tf()\n\tch <- snd\n"
            "\tvar g = vr\n\t_ = g\n\treturn ret\n}\n"
        },
    )
    found = calls(parse_repository(repo, language="go"))
    for target in ("ret", "asg", "snd", "vr"):
        assert ("a.go::F", f"a.go::{target}") in found, target


def test_receiver_shadowed_by_select_receive_or_variadic_closure_param(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype S struct{}\ntype Other struct{}\n\n"
            "func (s *S) m() {}\nfunc (o *Other) m() {}\n\n"
            "func (s *S) A(ch chan *Other) {\n\tselect {\n\tcase s := <-ch:\n\t\ts.m()\n\t}\n}\n\n"
            "func (s *S) B() {\n\tf := func(s ...*Other) {\n\t\ts.m()\n\t}\n\tf()\n}\n"
        },
    )
    result = parse_repository(repo, language="go")
    # `s` is no longer the receiver, so the call must never be attributed to
    # S.m as a definite edge. (`m` is unexported and defined on two types, so
    # it is linked to *both* as ambiguous -- see the dead-code tests below.)
    definite = {
        (e.source, e.target)
        for e in result.edges
        if e.kind == EdgeKind.CALLS and not e.ambiguous
    }
    assert ("a.go::S.A", "a.go::S.m") not in definite
    assert ("a.go::S.B", "a.go::S.m") not in definite


# Unexported method calls on variables of unknown type -----------------------


def edges_of(result, source):
    return {
        (e.target, e.ambiguous)
        for e in result.edges
        if e.source == source and e.kind == EdgeKind.CALLS
    }


def test_unexported_method_called_on_a_local_links_to_it_as_ambiguous(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype Cache struct{}\n\nfunc (c *Cache) start() {}\n\n"
            "func New() *Cache {\n\tc := &Cache{}\n\tc.start()\n\treturn c\n}\n",
            "b.go": "package a\n\nfunc Boot(x *Cache) {\n\tx.start()\n}\n",
        },
    )
    result = parse_repository(repo, language="go")
    assert ("a.go::Cache.start", True) in edges_of(result, "a.go::New")
    # also across files of the same package
    assert ("a.go::Cache.start", True) in edges_of(result, "b.go::Boot")
    assert ("unresolved::c.start", True) not in edges_of(result, "a.go::New")
    reverse = build_reverse_caller_index(result.edges)
    dead = {c.node_id for c in find_dead_code_candidates(result.nodes, reverse, root=repo)}
    assert "a.go::Cache.start" not in dead


def test_same_named_unexported_methods_on_several_types_are_all_candidates(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype A struct{}\ntype B struct{}\n\n"
            "func (a *A) run() {}\nfunc (b *B) run() {}\n\nfunc Go(x any) {\n\tx.run()\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::Go")
    assert {("a.go::A.run", True), ("a.go::B.run", True)} <= found


def test_too_many_same_named_candidates_stay_unresolved(tmp_path):
    types = "".join(f"type T{i} struct{{}}\nfunc (t *T{i}) reset() {{}}\n" for i in range(7))
    source = f"package a\n\n{types}\nfunc Go(x any) {{\n\tx.reset()\n}}\n"
    repo = make_repo(tmp_path, {"a.go": source})
    found = edges_of(parse_repository(repo, language="go"), "a.go::Go")
    assert ("unresolved::x.reset", True) in found
    assert not any(t.startswith("a.go::") and t.endswith(".reset") for t, _ in found)


def test_exported_method_names_are_never_guessed(tmp_path):
    """`buf.String()` could be any imported type's method, so a same-package
    method that happens to share the name must not be linked to it."""
    repo = make_repo(
        tmp_path,
        {
            "a.go": 'package a\n\ntype T struct{}\n\nfunc (t *T) String() string { return "" }\n\n'
            "func Go(buf *bytes.Buffer) string {\n\treturn buf.String()\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::Go")
    assert not any(t == "a.go::T.String" for t, _ in found)


def test_unexported_method_is_not_linked_across_packages(tmp_path):
    """Another package cannot call an unexported method, so a same-named
    method in a different directory is not a candidate."""
    repo = make_repo(
        tmp_path,
        {
            "go.mod": "module example.com/m\n",
            "one/a.go": "package one\n\ntype T struct{}\n\nfunc (t *T) start() {}\n",
            "two/b.go": "package two\n\nfunc Go(x any) {\n\tx.start()\n}\n",
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "two/b.go::Go")
    assert not any("T.start" in t for t, _ in found)


# Receivers with no name, method values, and package-level initializers ------


def dead_ids(result, repo):
    reverse = build_reverse_caller_index(result.edges)
    return {c.node_id for c in find_dead_code_candidates(result.nodes, reverse, root=repo)}


def test_unexported_method_called_on_an_unnamed_receiver_is_linked(tmp_path):
    """`x.(T).m()` / `f().m()` / `items[i].m()` have no variable name to
    resolve, but an unexported `m` can only live in this package."""
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype T struct{}\n\nfunc (t *T) fragments() {}\n\n"
            "func A(x any) {\n\tx.(*T).fragments()\n}\n\n"
            "func B() {\n\tget().fragments()\n}\n\n"
            "func C(items []*T) {\n\titems[0].fragments()\n}\n\n"
            "func get() *T { return nil }\n"
        },
    )
    result = parse_repository(repo, language="go")
    for source in ("a.go::A", "a.go::B", "a.go::C"):
        assert ("a.go::T.fragments", True) in edges_of(result, source), source
    assert "a.go::T.fragments" not in dead_ids(result, repo)


def test_unnamed_receiver_with_an_exported_method_is_not_guessed(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype T struct{}\n\nfunc (t *T) Fragments() {}\n\n"
            "func A(x any) {\n\tx.(*T).Fragments()\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::A")
    assert not any(t == "a.go::T.Fragments" for t, _ in found)


def test_method_value_on_a_typed_local_links_to_the_unexported_method(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype Resolver struct{}\n\nfunc (r *Resolver) resolveRef() {}\n\n"
            "type Loader struct{ Read func() }\n\n"
            "func Setup(resolver *Resolver, loader *Loader) {\n"
            "\tloader.Read = resolver.resolveRef\n}\n"
        },
    )
    result = parse_repository(repo, language="go")
    assert ("a.go::Resolver.resolveRef", True) in edges_of(result, "a.go::Setup")
    assert "a.go::Resolver.resolveRef" not in dead_ids(result, repo)


def test_package_level_initializers_reference_functions_from_the_file(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype Command struct{ Run func() }\n\n"
            "func runIt() {}\nfunc build() *Command { return nil }\n"
            "func inTable() {}\nfunc unused() {}\n\n"
            "var cmd = &Command{Run: runIt}\nvar made = build()\n"
            'var table = map[string]func(){"k": inTable}\n'
        },
    )
    result = parse_repository(repo, language="go")
    found = edges_of(result, "a.go")
    for target in ("runIt", "build", "inTable"):
        assert (f"a.go::{target}", False) in found, target
    dead = dead_ids(result, repo)
    assert dead & {"a.go::runIt", "a.go::build", "a.go::inTable"} == set()
    assert "a.go::unused" in dead


# Precision limits on the unexported-method heuristic ------------------------


def test_a_field_read_is_not_linked_as_a_method_value(tmp_path):
    """`s.page` is a struct field on S; an unrelated type happens to have a
    method `page`. Reading the field must not link to that method."""
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype S struct{ page int }\ntype X struct{}\n\n"
            "func (x *X) page() {}\n\n"
            "func F(s *S) {\n\tuse(s.page)\n\t_ = &K{v: s.page}\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::F")
    assert not any(t == "a.go::X.page" for t, _ in found)


def test_calling_a_func_typed_field_is_not_linked_to_a_same_named_method(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype T struct{ handler func() }\ntype U struct{}\n\n"
            "func (u *U) handler() {}\n\n"
            "func Run(t *T) {\n\tt.handler()\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::Run")
    assert not any(t == "a.go::U.handler" for t, _ in found)


def test_known_receiver_type_without_the_method_does_not_fall_back_package_wide(tmp_path):
    """`this.m()` on a T that declares no `m` is only valid through an
    embedded type, so it must not be linked to an unrelated type's `m`."""
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype T struct{}\ntype U struct{}\n\n"
            "func (u *U) m() {}\n\nfunc (t *T) Go() {\n\tt.m()\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::T.Go")
    assert not any(t == "a.go::U.m" for t, _ in found)


def test_known_receiver_type_that_embeds_another_still_links(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype U struct{}\ntype T struct{ U }\n\n"
            "func (u *U) m() {}\n\nfunc (t *T) Go() {\n\tt.m()\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go::T.Go")
    assert ("a.go::U.m", True) in found


def test_package_level_function_literal_parameters_shadow_package_functions(tmp_path):
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\nfunc hook() {}\nfunc reg(f func()) {}\n\n"
            "var h = func(hook func()) { reg(hook) }\n"
            "var h3 = func() {\n\thook := 1\n\t_ = hook\n}\n"
        },
    )
    found = edges_of(parse_repository(repo, language="go"), "a.go")
    assert ("a.go::hook", False) not in found


# Generic calls with explicit type arguments ---------------------------------


def test_generic_function_call_with_explicit_type_arguments_is_a_call(tmp_path):
    """tree-sitter-go parses `f[A, B](x)` as a generic type conversion, not a
    call_expression, so every such call used to be invisible."""
    repo = make_repo(
        tmp_path,
        {
            "a.go": "package a\n\ntype Pool[Q, R any] struct{}\n\n"
            "func newDispatcher[Q, R any](opts int) *Pool[Q, R] { return nil }\n"
            "func one[T any](x T) T { return x }\n\n"
            "func Use(opts int) {\n\td := newDispatcher[int, string](opts)\n"
            "\t_ = one[int](3)\n\t_ = d\n\t_ = []byte(\"x\")\n}\n"
        },
    )
    result = parse_repository(repo, language="go")
    found = edges_of(result, "a.go::Use")
    assert ("a.go::newDispatcher", False) in found
    assert ("a.go::one", False) in found
    # a plain conversion is still not a call to anything
    assert not any("byte" in t for t, _ in found)
    assert "a.go::newDispatcher" not in dead_ids(result, repo)
