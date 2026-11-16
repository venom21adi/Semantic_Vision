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
    found = calls(parse_repository(repo, language="go"))
    assert ("a.go::S.A", "a.go::S.m") not in found
    assert ("a.go::S.B", "a.go::S.m") not in found
