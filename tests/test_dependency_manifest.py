from pathlib import Path

from semantic_vision.analysis.dependency_manifest import (
    DeclaredPackage,
    find_declared_dependencies,
    parse_package_json,
    parse_pyproject,
    parse_requirements_txt,
    resolve_used_dependencies,
)


def test_parse_pyproject_extracts_name_and_version_from_dependencies(tmp_path: Path):
    path = tmp_path / "pyproject.toml"
    path.write_text(
        "[project]\ndependencies = "
        '["fastapi>=0.141.1", "httpx>=0.28.1", "uvicorn[standard]>=0.52.4"]\n',
        encoding="utf-8",
    )

    packages = parse_pyproject(path)

    assert packages["fastapi"] == DeclaredPackage(
        name="fastapi", version="0.141.1", ecosystem="PyPI"
    )
    assert packages["httpx"].version == "0.28.1"
    # Extras bracket stripped -- name extraction stops before "["
    assert packages["uvicorn"] == DeclaredPackage(
        name="uvicorn", version="0.52.4", ecosystem="PyPI"
    )


def test_parse_pyproject_returns_empty_for_missing_or_malformed_file(tmp_path: Path):
    assert parse_pyproject(tmp_path / "does-not-exist.toml") == {}

    bad = tmp_path / "bad.toml"
    bad.write_text("this is not [valid toml", encoding="utf-8")
    assert parse_pyproject(bad) == {}


def test_parse_pyproject_returns_empty_when_no_project_dependencies_table(tmp_path: Path):
    path = tmp_path / "pyproject.toml"
    path.write_text('[tool.other]\nname = "x"\n', encoding="utf-8")

    assert parse_pyproject(path) == {}


def test_parse_pyproject_direct_url_dependency_gets_no_fabricated_version(tmp_path: Path):
    """A PEP 508 direct-reference dependency (`pkg @ git+https://...`) has
    no real version constraint at all -- extracting the git tag's own
    version-looking suffix as if it were the package's version would be a
    fabricated, misleading value, not a real approximation."""
    path = tmp_path / "pyproject.toml"
    path.write_text(
        '[project]\ndependencies = ["mypkg @ git+https://github.com/foo/mypkg.git@v1.0.0"]\n',
        encoding="utf-8",
    )

    packages = parse_pyproject(path)

    assert packages["mypkg"].name == "mypkg"
    assert packages["mypkg"].version is None


def test_parse_requirements_txt_skips_comments_and_options(tmp_path: Path):
    path = tmp_path / "requirements.txt"
    path.write_text(
        "# a comment\n-r other.txt\nrequests==2.31.0\n\nflask>=2.0\n",
        encoding="utf-8",
    )

    packages = parse_requirements_txt(path)

    assert set(packages) == {"requests", "flask"}
    assert packages["requests"].version == "2.31.0"


def test_parse_requirements_txt_skips_vcs_and_direct_url_installs(tmp_path: Path):
    """A VCS/direct-URL line must be skipped entirely, not partially parsed
    -- `_NAME_RE` would otherwise match a meaningless prefix (`"git"` from
    `"git+https://..."`) as if it were a real package name, and scrape a
    version out of the URL's own git tag that belongs to nothing real."""
    path = tmp_path / "requirements.txt"
    path.write_text(
        "git+https://github.com/foo/bar.git@v1.2.3#egg=bar\n"
        "https://example.com/some-package.whl\n"
        "requests==2.31.0\n",
        encoding="utf-8",
    )

    packages = parse_requirements_txt(path)

    assert set(packages) == {"requests"}
    assert "git" not in packages


def test_parse_requirements_txt_skips_relative_path_installs(tmp_path: Path):
    path = tmp_path / "requirements.txt"
    path.write_text("./local-pkg\nrequests==2.31.0\n", encoding="utf-8")

    packages = parse_requirements_txt(path)

    assert set(packages) == {"requests"}


def test_parse_package_json_covers_both_dependency_sections(tmp_path: Path):
    path = tmp_path / "package.json"
    path.write_text(
        '{"dependencies": {"react": "^18.3.1"}, "devDependencies": {"vite": "5.0.0"}}',
        encoding="utf-8",
    )

    packages = parse_package_json(path)

    assert packages["react"] == DeclaredPackage(name="react", version="18.3.1", ecosystem="npm")
    assert packages["vite"].ecosystem == "npm"


def test_find_declared_dependencies_merges_python_and_js_manifests(tmp_path: Path):
    (tmp_path / "pyproject.toml").write_text(
        '[project]\ndependencies = ["fastapi>=0.1.0"]\n', encoding="utf-8"
    )
    (tmp_path / "package.json").write_text(
        '{"dependencies": {"react": "18.0.0"}}', encoding="utf-8"
    )

    packages = find_declared_dependencies(tmp_path)

    assert set(packages) == {"fastapi", "react"}


def test_resolve_used_dependencies_only_returns_packages_both_used_and_declared():
    declared = {
        "requests": DeclaredPackage(name="requests", version="2.31.0", ecosystem="PyPI"),
        "unused-pkg": DeclaredPackage(name="unused-pkg", version="1.0.0", ecosystem="PyPI"),
    }
    external_targets = ["external::requests.sessions", "external::os.path"]

    used = resolve_used_dependencies(external_targets, declared)

    assert [pkg.name for pkg in used] == ["requests"]


def test_resolve_used_dependencies_takes_first_segment_of_an_unscoped_sub_path_import():
    declared = {"lodash": DeclaredPackage(name="lodash", version="4.17.21", ecosystem="npm")}
    external_targets = ["external::lodash/fp"]

    used = resolve_used_dependencies(external_targets, declared)

    assert [pkg.name for pkg in used] == ["lodash"]


def test_resolve_used_dependencies_resolves_a_scoped_npm_package_by_its_full_scope_slash_name():
    """A scoped import (`@scope/pkg`) must resolve against the *two*-segment
    package name `package.json` itself declares (`"@babel/core": "..."`,
    never a bare `"@babel"` key) -- not just the scope alone, which isn't a
    real, independently installable package."""
    declared = {
        "@babel/core": DeclaredPackage(name="@babel/core", version="7.24.0", ecosystem="npm")
    }
    external_targets = ["external::@babel/core"]

    used = resolve_used_dependencies(external_targets, declared)

    assert [pkg.name for pkg in used] == ["@babel/core"]


def test_resolve_used_dependencies_resolves_a_scoped_package_import_with_a_sub_path():
    declared = {
        "@babel/core": DeclaredPackage(name="@babel/core", version="7.24.0", ecosystem="npm")
    }
    external_targets = ["external::@babel/core/lib/transform"]

    used = resolve_used_dependencies(external_targets, declared)

    assert [pkg.name for pkg in used] == ["@babel/core"]
