"""Go support: extraction, import resolution, and cross-file package-scope
call resolution. See `languages/go.py` for why the last one exists."""

from pathlib import Path

import pytest

from semantic_vision.languages import get_adapter
from semantic_vision.languages.base import ParseSyntaxError
from semantic_vision.languages.registry import detect_languages
from semantic_vision.models import EdgeKind
from semantic_vision.parser.extractor import RawCall, RawImport
from semantic_vision.parser.go_extractor import extract_go_module
from semantic_vision.repo_parser import parse_repository
from semantic_vision.resolver.go_imports import (
    default_package_name,
    dotted_module_path,
    local_package_dir,
)

FIXTURE = Path(__file__).parent / "fixtures" / "go_repo"


def extract(source: str, rel_path: str = "a.go"):
    return extract_go_module(source, rel_path)


# --- extractor ---------------------------------------------------------------


def test_import_forms():
    raw = extract(
        'package a\nimport (\n\t"fmt"\n\tu "example.com/x/util"\n\t_ "embed"\n\t. "strings"\n)\n'
        'import "os"\n'
    )
    assert [(i.module, i.name, i.asname) for i in raw.imports] == [
        ("fmt", "fmt", None),
        ("example.com/x/util", "util", "u"),
        ("embed", "embed", "_"),
        ("strings", "strings", "."),
        ("os", "os", None),
    ]
    assert all(isinstance(i, RawImport) and i.level == 0 for i in raw.imports)


def test_struct_interface_methods_and_receiver_normalised_to_this():
    raw = extract(
        "package a\n"
        "type S struct { n, m int; Base }\n"
        "type I interface { Do() }\n"
        "func (srv *S) Run() { srv.helper(); srv.client.Do(); pkg.Fn() }\n"
    )
    by_name = {c.name: c for c in raw.classes}
    assert set(by_name) == {"S", "I"}
    assert [a.name for a in by_name["S"].attributes] == ["n", "m", "Base"]
    assert by_name["I"].methods == []  # signatures, not definitions
    run = by_name["S"].methods[0]
    assert [c.dotted for c in run.calls] == ["this.helper", "this.client.Do", "pkg.Fn"]


def test_method_on_type_declared_elsewhere_gets_methods_only_class():
    raw = extract("package a\nfunc (s *Server) Run() {}\nfunc (Server) Other() {}\n")
    assert [c.name for c in raw.classes] == ["Server"]
    assert [m.name for m in raw.classes[0].methods] == ["Run", "Other"]
    assert (raw.classes[0].lineno, raw.classes[0].end_lineno) == (2, 3)


def test_generic_receiver_and_generic_call():
    raw = extract(
        "package a\ntype Box[T any] struct{}\nfunc (b *Box[T]) Get() T { return New[int]() }\n"
    )
    cls = raw.classes[0]
    assert cls.name == "Box"
    assert cls.methods[0].calls == [RawCall(dotted="New", lineno=3)]


def test_struct_literals_are_constructions_but_slices_are_not():
    raw = extract("package a\nfunc f() { _ = &S{}; _ = []int{1}; _ = pkg.T{} }\n")
    assert [c.dotted for c in raw.functions[0].calls] == ["S", "pkg.T"]


def test_closure_calls_belong_to_the_enclosing_function():
    raw = extract("package a\nfunc f() { g := func() { inner() }; g(); go worker() }\n")
    assert [c.dotted for c in raw.functions[0].calls] == ["inner", "g", "worker"]


def test_multiple_init_functions_get_distinct_names():
    raw = extract("package a\nfunc init() {}\nfunc init() {}\nfunc init() {}\n")
    assert [f.name for f in raw.functions] == ["init", "init#2", "init#3"]


def test_package_vars_and_consts_skip_blank():
    raw = extract("package a\nvar x, _ = 1, 2\nconst (\n\tA = 1\n\tB = 2\n)\n")
    assert [v.name for v in raw.variables] == ["x", "A", "B"]


def test_dynamic_call_has_no_dotted_name():
    raw = extract("package a\nfunc f() { get()(); fns[0]() }\n")
    # Outer calls come first: `get()()` calls a call result (no name), its
    # inner `get()` is a plain call; `fns[0]()` calls an indexed element.
    assert [c.dotted for c in raw.functions[0].calls] == [None, "get", None]


# --- adapter / import helpers ------------------------------------------------


def test_adapter_registered_and_syntax_error_reported_with_line():
    adapter = get_adapter("go")
    assert adapter.language_id == "go"
    assert adapter.file_extensions == frozenset({".go"})
    assert adapter.parse_file("package a\nfunc f() {}\n", "a.go").functions[0].name == "f"
    with pytest.raises(ParseSyntaxError) as exc:
        adapter.parse_file("package a\n\nfunc broken( {\n", "a.go")
    assert exc.value.line == 3


def test_dotted_module_path():
    assert dotted_module_path("internal/util/helpers.go") == "internal.util.helpers"


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("net/http", "http"),
        ("example.com/lib/v2", "lib"),
        ("gopkg.in/yaml.v3", "yaml"),
        ("github.com/x/y", "y"),
    ],
)
def test_default_package_name(path, expected):
    assert default_package_name(path) == expected


def test_local_package_dir_with_go_mod():
    dirs = {"", "internal/util", "sub/internal/x"}
    mods = {"": "example.com/app", "sub": "example.com/app/sub"}
    assert local_package_dir("example.com/app/internal/util", mods, dirs) == "internal/util"
    # The nested module's path wins over its parent's prefix.
    assert local_package_dir("example.com/app/sub/internal/x", mods, dirs) == "sub/internal/x"
    assert local_package_dir("github.com/other/util", mods, dirs) is None
    assert local_package_dir("example.com/app/missing", mods, dirs) is None


def test_local_package_dir_fallback_without_go_mod_skips_stdlib():
    dirs = {"pkg/http", "internal/util"}
    assert local_package_dir("example.com/app/internal/util", {}, dirs) == "internal/util"
    assert local_package_dir("net/http", {}, dirs) is None


# --- whole-repository parse ----------------------------------------------------


@pytest.fixture(scope="module")
def result():
    return parse_repository(FIXTURE, language="go")


def edge_set(result, kind):
    return {(e.source, e.target) for e in result.edges if e.kind == kind}


def test_detect_languages_finds_go():
    assert detect_languages(FIXTURE) == ["go"]


def test_vendor_directory_is_excluded_and_syntax_error_isolated(result):
    assert not any(n.file.startswith("vendor") for n in result.nodes)
    assert [(e.file, e.line) for e in result.parse_errors] == [("broken.go", 3)]
    # The broken file doesn't stop everything else from parsing.
    assert any(n.id == "main.go::main" for n in result.nodes)


def test_nodes_for_types_methods_and_inits(result):
    ids = {n.id for n in result.nodes}
    assert {
        "server.go::Server",
        "server.go::Server.Run",
        "server.go::Handler",
        "server_setup.go::Server",  # methods-only class for the same type
        "server_setup.go::Server.setup",
        "main.go::init",
        "main.go::init#2",
        "internal/util/util.go::Tool.Use",
    } <= ids


def test_imports_resolve_local_to_package_dir_and_third_party_external(result):
    imports = edge_set(result, EdgeKind.IMPORTS)
    assert ("main.go", "internal/util") in imports
    assert ("main.go", "external::fmt") in imports
    assert ("main.go", "external::net/http") in imports
    assert ("main.go", "external::github.com/other/thing") in imports


def test_cross_file_same_package_calls_resolve(result):
    calls = edge_set(result, EdgeKind.CALLS)
    # main.go -> NewServer in server.go (bare cross-file function)
    assert ("main.go::main", "server.go::NewServer") in calls
    # s.Run() has no static type info, so it stays unresolved -- not guessed.
    assert ("main.go::main", "unresolved::s.Run") in calls
    # this.setup() lives in a different file than Run
    assert ("server.go::Server.Run", "server_setup.go::Server.setup") in calls
    # bare call to a function in a sibling file
    assert ("server_setup.go::Server.setup", "server_setup.go::helperFunc") in calls
    assert ("server.go::Server.Run", "server_setup.go::cleanup") in calls
    # struct literal construction -> the type
    assert ("server.go::NewServer", "server.go::Server") in calls


def test_calls_through_imports(result):
    calls = edge_set(result, EdgeKind.CALLS)
    assert ("main.go::main", "internal/util/util.go::Helper") in calls  # local package
    assert ("internal/util/util.go::Helper", "internal/util/inner.go::inner") in calls
    assert ("main.go::main", "external::fmt.Println") in calls
    assert ("main.go::main", "external::github.com/other/thing.Do") in calls  # alias `th`
    assert ("main.go::main", "external::builtin.len") in calls


def test_unresolvable_field_call_stays_unresolved(result):
    calls = edge_set(result, EdgeKind.CALLS)
    assert ("server.go::Server.Run", "unresolved::this.client.Do") in calls
