"""Precomputes static API-response fixtures for the frontend's demo mode.

Drives the real FastAPI app in-process (same pattern as tests/test_api.py)
against the two frozen demo repos under scripts/demo_repos/ (Python) and a
locally cloned copy of axios (JS), and writes consolidated JSON bundles
under frontend/public/demo/<slug>/ for the static frontend build to fetch
at runtime instead of a live backend.

Usage:
    .venv/Scripts/python.exe scripts/build_demo_fixtures.py
    .venv/Scripts/python.exe scripts/build_demo_fixtures.py --js-repo <path-to-cloned-axios-lib>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from fastapi.testclient import TestClient  # noqa: E402

from semantic_vision.api.app import create_app  # noqa: E402

OUT_ROOT = REPO_ROOT / "frontend" / "public" / "demo"

PYTHON_SHOP_PATH = REPO_ROOT / "scripts" / "demo_repos" / "python_shop"
PYTHON_SHOP_MANIFEST = REPO_ROOT / "scripts" / "demo_repos" / "python_shop_manifest.json"

# Functions picked to also get a real, saved AI-generated doc (see
# scripts/generate_demo_docs.py) -- interesting call chains, branching, or
# lineage touch points, one from each corner of the app.
PYTHON_SHOP_SHOWCASE_DOCS = [
    "services/orders.py::transition_order_status",
    "services/customers.py::flag_high_value_customers",
    "services/payments.py::reconcile_payment_methods",
    "services/reporting.py::monthly_revenue_report",
    "jobs/scheduler.py::retry_with_backoff",
    "utils/validation.py::validate_order_payload",
]

AXIOS_SHOWCASE_DOCS = [
    "core/Axios.js::Axios._request",
    "adapters/http.js::setProxy",
    "utils.js::merge",
    "helpers/shouldBypassProxy.js::shouldBypassProxy",
    "helpers/resolveConfig.js::resolveConfig",
    "core/dispatchRequest.js::dispatchRequest",
]


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def build_repo_bundle(client: TestClient, *, slug: str, repo_path: str, language: str,
                       showcase_doc_ids: list[str], display_name: str, description: str,
                       dbt_manifest_path: Path | None = None) -> None:
    out_dir = OUT_ROOT / slug
    print(f"\n=== {slug} ({repo_path}) ===")

    parse_result = client.post(
        "/api/parse-repo", json={"path": repo_path, "language": language}
    )
    parse_result.raise_for_status()
    stats = parse_result.json()
    print("parsed:", stats)

    graph_pre = client.get("/api/graph", params={"path": repo_path}).json()
    dump(out_dir / ("graph-pre-dbt.json" if dbt_manifest_path else "graph.json"), graph_pre)

    dbt_ingest = None
    graph_active = graph_pre
    if dbt_manifest_path is not None:
        ingest_resp = client.post(
            "/api/dataflow/dbt-manifest",
            params={"path": repo_path},
            json={"path": str(dbt_manifest_path)},
        )
        ingest_resp.raise_for_status()
        dbt_ingest = ingest_resp.json()
        print("dbt ingest:", dbt_ingest)
        dump(out_dir / "dbt-ingest.json", dbt_ingest)

        graph_active = client.get("/api/graph", params={"path": repo_path}).json()
        dump(out_dir / "graph-post-dbt.json", graph_active)

    complexity = client.get("/api/complexity", params={"path": repo_path}).json()
    dump(out_dir / "complexity.json", complexity)

    function_ids = [n["id"] for n in graph_active["nodes"] if n["kind"] == "function"]
    table_column_ids = [n["id"] for n in graph_active["nodes"] if n["kind"] in ("table", "column")]

    impact_by_id = {}
    flowchart_by_id = {}
    source_by_id = {}

    for node_id in function_ids + table_column_ids:
        impact_resp = client.get("/api/impact", params={"path": repo_path, "id": node_id})
        if impact_resp.status_code == 200:
            impact_by_id[node_id] = impact_resp.json()

    for node_id in function_ids:
        flowchart_resp = client.get("/api/flowchart", params={"path": repo_path, "id": node_id})
        if flowchart_resp.status_code == 200:
            flowchart_by_id[node_id] = flowchart_resp.json()

        source_resp = client.get("/api/function-source", params={"path": repo_path, "id": node_id})
        if source_resp.status_code == 200:
            source_by_id[node_id] = source_resp.json()

    dump(out_dir / "impact.json", impact_by_id)
    dump(out_dir / "flowchart.json", flowchart_by_id)
    dump(out_dir / "function-source.json", source_by_id)

    print(
        f"functions={len(function_ids)} tables/columns={len(table_column_ids)} "
        f"impact={len(impact_by_id)} flowchart={len(flowchart_by_id)} source={len(source_by_id)}"
    )

    missing_showcase = [fid for fid in showcase_doc_ids if fid not in function_ids]
    if missing_showcase:
        print(f"WARNING: showcase doc ids not found in graph: {missing_showcase}")

    meta = {
        "slug": slug,
        "displayName": display_name,
        "language": language,
        "description": description,
        "nodeCount": stats["node_count"],
        "edgeCount": stats["edge_count"],
        "hasDataLineage": dbt_manifest_path is not None,
        "showcaseDocIds": [fid for fid in showcase_doc_ids if fid in function_ids],
    }
    dump(out_dir / "meta.json", meta)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--js-repo",
        default=str(Path.home() / "AppData/Local/Temp/sv-demo-src/axios/lib"),
        help="Path to a locally cloned axios lib/ directory (not committed to this repo).",
    )
    args = parser.parse_args()

    app = create_app()
    client = TestClient(app)

    build_repo_bundle(
        client,
        slug="python-shop",
        repo_path=str(PYTHON_SHOP_PATH),
        language="python",
        showcase_doc_ids=PYTHON_SHOP_SHOWCASE_DOCS,
        display_name="Python: jaffle-shop-style order service",
        description=(
            "A small e-commerce backend (SQLAlchemy models, services, jobs) whose "
            "customers/orders tables match dbt Labs' jaffle_shop tutorial schema -- "
            "wired for real code-to-data lineage."
        ),
        dbt_manifest_path=PYTHON_SHOP_MANIFEST,
    )

    js_repo = Path(args.js_repo)
    if not js_repo.exists():
        print(f"\nSkipping JS/TS repo -- not found at {js_repo}. Clone axios first.")
        return

    build_repo_bundle(
        client,
        slug="axios",
        repo_path=str(js_repo),
        language="javascript",
        showcase_doc_ids=AXIOS_SHOWCASE_DOCS,
        display_name="JavaScript: axios",
        description="The real axios HTTP client source -- adapters, interceptors, and config merging.",
    )


if __name__ == "__main__":
    main()
