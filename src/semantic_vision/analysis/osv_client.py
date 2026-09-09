"""OSV (https://osv.dev) vulnerability-feed lookup -- the one outbound
network call anywhere in Semantic Vision's analysis pipeline (see
docs/ideas/REPO-INTELLIGENCE-IDEAS.md's Idea 3), gated behind an explicit,
per-request opt-in (`DependencyRiskRequest.confirm_network_access`, enforced
server-side in `api/routes.py`) the same way AI documentation's provider
choice already is -- never silent, never on by default. Every other
analysis this project does is local and offline by design; this is the one
deliberate exception, made only when a caller explicitly asks for it.
"""

from __future__ import annotations

import httpx
from pydantic import BaseModel

from semantic_vision.analysis.dependency_manifest import DeclaredPackage

OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch"
_REQUEST_TIMEOUT_SECONDS = 10.0


class OsvQueryError(Exception):
    """Raised on any network failure, timeout, non-2xx response, or
    unexpected response shape from OSV -- the API layer degrades this to
    `available: False` with a message, never a 500, matching every other
    outbound-dependent path in this project (`compute_file_churn`'s
    degrade-to-empty on a git failure, `list_ollama_models`'s
    degrade-to-empty-list on a connection failure)."""


class VulnerabilitySummary(BaseModel):
    id: str
    """The OSV/GHSA/PYSEC advisory id (e.g. `GHSA-xxxx-...`). OSV's batch
    query endpoint intentionally returns only an id + a modified timestamp
    per vulnerability, not full details (summary/severity) -- fetching
    those needs a separate `GET /v1/vulns/{id}` call per finding, not done
    here (a real, deliberate scope cut, not an oversight). The id alone is
    enough to link out to osv.dev's own advisory page for details."""


def query_osv_batch(packages: list[DeclaredPackage]) -> dict[str, list[VulnerabilitySummary]]:
    """Queries OSV for known vulnerabilities affecting each package at its
    declared version, keyed by lowercased package name (matching
    `dependency_manifest`'s own key convention). A package with no
    resolvable version is skipped -- OSV's batch API requires one per
    query, and there's no meaningful "any version" query to send instead.
    Raises `OsvQueryError` on any failure -- never returns a partial or
    best-effort result silently, since a caller couldn't otherwise tell
    "no vulnerabilities found" apart from "the query itself half-failed."
    """
    queryable = [pkg for pkg in packages if pkg.version]
    if not queryable:
        return {}

    body = {
        "queries": [
            {"package": {"name": pkg.name, "ecosystem": pkg.ecosystem}, "version": pkg.version}
            for pkg in queryable
        ]
    }
    try:
        with httpx.Client(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = client.post(OSV_BATCH_URL, json=body)
    except httpx.HTTPError as exc:
        raise OsvQueryError(f"Could not reach osv.dev: {exc}") from exc
    if response.status_code >= 400:
        raise OsvQueryError(f"osv.dev returned HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise OsvQueryError(f"osv.dev returned an unreadable response: {exc}") from exc

    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list) or len(results) != len(queryable):
        raise OsvQueryError("osv.dev returned an unexpected response shape")

    # `zip(..., strict=True)` only guards against a *length* mismatch --
    # OSV's batch response carries no per-item package identifier to
    # re-correlate against the request, so this relies on OSV's documented
    # contract that `results[i]` answers `queries[i]`, the same
    # positional-ordering assumption a batch API like this is documented
    # to guarantee. There's no local way to detect (let alone recover
    # from) OSV silently reordering its own response.
    vulns_by_package: dict[str, list[VulnerabilitySummary]] = {}
    for pkg, result in zip(queryable, results, strict=True):
        vulns = result.get("vulns") if isinstance(result, dict) else None
        if not vulns:
            continue
        vulns_by_package[pkg.name.lower()] = [
            VulnerabilitySummary(id=v["id"])
            for v in vulns
            if isinstance(v, dict) and isinstance(v.get("id"), str)
        ]
    return vulns_by_package
