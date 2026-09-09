import httpx
import pytest

from semantic_vision.analysis import osv_client
from semantic_vision.analysis.dependency_manifest import DeclaredPackage


class _FakeResponse:
    def __init__(self, status_code: int, json_body):
        self.status_code = status_code
        self._json_body = json_body

    def json(self):
        return self._json_body


class _FakeClient:
    """Stands in for `httpx.Client` -- never hits the real OSV API in tests."""

    def __init__(self, response=None, raise_error=None):
        self._response = response
        self._raise_error = raise_error

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json):
        if self._raise_error:
            raise self._raise_error
        return self._response


def test_query_osv_batch_returns_empty_for_no_queryable_packages():
    packages = [DeclaredPackage(name="foo", version=None, ecosystem="PyPI")]

    assert osv_client.query_osv_batch(packages) == {}


def test_query_osv_batch_parses_vulnerabilities_keyed_by_package(monkeypatch):
    packages = [
        DeclaredPackage(name="vulnerable-pkg", version="1.0.0", ecosystem="PyPI"),
        DeclaredPackage(name="safe-pkg", version="2.0.0", ecosystem="PyPI"),
    ]
    response = _FakeResponse(
        200,
        {
            "results": [
                {"vulns": [{"id": "GHSA-xxxx", "modified": "2024-01-01"}]},
                {},
            ]
        },
    )
    monkeypatch.setattr(osv_client.httpx, "Client", lambda **kwargs: _FakeClient(response=response))

    result = osv_client.query_osv_batch(packages)

    assert set(result) == {"vulnerable-pkg"}
    assert result["vulnerable-pkg"][0].id == "GHSA-xxxx"


def test_query_osv_batch_skips_packages_with_no_version():
    packages = [
        DeclaredPackage(name="no-version-pkg", version=None, ecosystem="PyPI"),
    ]

    # No fake client set up at all -- if this package were queried anyway,
    # the un-mocked real `httpx.Client` would raise, failing the test loudly.
    assert osv_client.query_osv_batch(packages) == {}


def test_query_osv_batch_raises_on_network_error(monkeypatch):
    packages = [DeclaredPackage(name="pkg", version="1.0.0", ecosystem="PyPI")]
    monkeypatch.setattr(
        osv_client.httpx,
        "Client",
        lambda **kwargs: _FakeClient(raise_error=httpx.ConnectError("boom")),
    )

    with pytest.raises(osv_client.OsvQueryError):
        osv_client.query_osv_batch(packages)


def test_query_osv_batch_raises_on_non_2xx_response(monkeypatch):
    packages = [DeclaredPackage(name="pkg", version="1.0.0", ecosystem="PyPI")]
    monkeypatch.setattr(
        osv_client.httpx, "Client", lambda **kwargs: _FakeClient(response=_FakeResponse(500, {}))
    )

    with pytest.raises(osv_client.OsvQueryError):
        osv_client.query_osv_batch(packages)


def test_query_osv_batch_raises_on_mismatched_results_length(monkeypatch):
    packages = [DeclaredPackage(name="pkg", version="1.0.0", ecosystem="PyPI")]
    monkeypatch.setattr(
        osv_client.httpx,
        "Client",
        lambda **kwargs: _FakeClient(response=_FakeResponse(200, {"results": []})),
    )

    with pytest.raises(osv_client.OsvQueryError):
        osv_client.query_osv_batch(packages)


def test_query_osv_batch_raises_on_unreadable_json(monkeypatch):
    class _BadJsonResponse(_FakeResponse):
        def json(self):
            raise ValueError("not json")

    packages = [DeclaredPackage(name="pkg", version="1.0.0", ecosystem="PyPI")]
    monkeypatch.setattr(
        osv_client.httpx,
        "Client",
        lambda **kwargs: _FakeClient(response=_BadJsonResponse(200, None)),
    )

    with pytest.raises(osv_client.OsvQueryError):
        osv_client.query_osv_batch(packages)
