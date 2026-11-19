"""`.csproj` layout: which project owns a file and which projects it can see."""

from pathlib import Path

from semantic_vision.resolver.csharp_projects import ProjectMap, _resolve_reference

FIXTURE = Path(__file__).parent / "fixtures" / "csharp_repo"


def test_scan_reads_every_project_and_its_references():
    pm = ProjectMap.scan(FIXTURE)
    assert set(pm.refs) == {"src/App", "src/Lib", "src/Other", "tests/App.Tests"}
    assert pm.refs["src/App"] == ("src/Lib",)
    assert pm.refs["tests/App.Tests"] == ("src/App",)
    assert pm.refs["src/Lib"] == ()


def test_files_belong_to_their_nearest_project():
    pm = ProjectMap.scan(FIXTURE)
    assert pm.project_of("src/App/Services/OrderService.cs") == "src/App"
    assert pm.project_of("src/Lib/Models/Order.cs") == "src/Lib"
    assert pm.project_of("elsewhere/Loose.cs") is None


def test_visibility_is_transitive_and_directional():
    pm = ProjectMap.scan(FIXTURE)
    assert pm.reachable("tests/App.Tests") == {"tests/App.Tests", "src/App", "src/Lib"}
    assert pm.reachable("src/App") == {"src/App", "src/Lib"}
    assert pm.reachable("src/Lib") == {"src/Lib"}
    assert "src/Other" not in pm.reachable("src/App")


def test_reference_cycles_terminate():
    pm = ProjectMap({"a": ("b",), "b": ("a",)})
    assert pm.reachable("a") == {"a", "b"}


def test_nested_project_owns_its_own_directory(tmp_path):
    (tmp_path / "outer" / "inner").mkdir(parents=True)
    (tmp_path / "outer" / "Outer.csproj").write_text("<Project/>")
    (tmp_path / "outer" / "inner" / "Inner.csproj").write_text("<Project/>")
    pm = ProjectMap.scan(tmp_path)
    assert pm.project_of("outer/a.cs") == "outer"
    assert pm.project_of("outer/inner/b.cs") == "outer/inner"


def test_build_output_and_hidden_directories_are_ignored(tmp_path):
    (tmp_path / "obj").mkdir()
    (tmp_path / "obj" / "Ghost.csproj").write_text("<Project/>")
    (tmp_path / ".hidden").mkdir()
    (tmp_path / ".hidden" / "Ghost.csproj").write_text("<Project/>")
    assert not ProjectMap.scan(tmp_path)


def test_a_repository_without_projects_is_falsy():
    assert not ProjectMap({})


def test_reference_paths_are_resolved_relative_to_the_project():
    assert _resolve_reference("src/App", "..\\Lib\\Lib.csproj") == "src/Lib"
    assert _resolve_reference("tests/T", "../../src/App/App.csproj") == "src/App"
    assert _resolve_reference("", "Sub/Sub.csproj") == "Sub"


def test_unevaluable_and_escaping_references_are_skipped():
    assert _resolve_reference("src/App", "$(SolutionDir)Lib\\Lib.csproj") is None
    assert _resolve_reference("src", "..\\..\\Outside\\O.csproj") is None
    assert (
        _resolve_reference("src/App", "$(MSBuildThisFileDirectory)..\\Lib\\Lib.csproj") == "src/Lib"
    )


def test_unreadable_project_file_does_not_break_the_scan(tmp_path):
    (tmp_path / "P.csproj").write_bytes(b"\xff\xfe\x00 not xml \x00")
    pm = ProjectMap.scan(tmp_path)
    assert pm.project_of("x.cs") == ""
