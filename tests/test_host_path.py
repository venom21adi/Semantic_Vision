import pytest

from semantic_vision.api.host_path import CONTAINER_REPO_ROOT, HOST_REPO_PATH_ENV, translate_host_path


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv(HOST_REPO_PATH_ENV, raising=False)


def test_unchanged_when_not_configured():
    assert translate_host_path("C:/Users/you/projects/my-api") == "C:/Users/you/projects/my-api"


def test_exact_match(monkeypatch):
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert translate_host_path("C:/Users/you/projects") == CONTAINER_REPO_ROOT


def test_exact_match_trailing_slash_and_backslashes(monkeypatch):
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert translate_host_path("C:\\Users\\you\\projects\\") == CONTAINER_REPO_ROOT


def test_case_insensitive_match(monkeypatch):
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert translate_host_path("c:/users/you/PROJECTS") == CONTAINER_REPO_ROOT


def test_subfolder_translated_preserving_case(monkeypatch):
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert (
        translate_host_path("C:\\Users\\you\\projects\\my-Api\\src")
        == f"{CONTAINER_REPO_ROOT}/my-Api/src"
    )


def test_non_matching_path_unchanged(monkeypatch):
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert translate_host_path("D:/somewhere/else") == "D:/somewhere/else"


def test_already_container_path_unchanged(monkeypatch):
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert translate_host_path("/workspace/repo/my-api") == "/workspace/repo/my-api"


def test_similar_but_unrelated_sibling_path_unchanged(monkeypatch):
    """`.../projects-old` must not match a prefix check against
    `.../projects` -- a naive `startswith` (no trailing slash) would."""
    monkeypatch.setenv(HOST_REPO_PATH_ENV, "C:/Users/you/projects")
    assert translate_host_path("C:/Users/you/projects-old/my-api") == "C:/Users/you/projects-old/my-api"
