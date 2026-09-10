"""Generates real AI Code Health recommendations for the demo repos.

Uses the actual /api/code-health/recommendations code path (local Ollama,
qwen2.5-coder:3b) against the demo repos, and writes the resulting markdown
into frontend/demo-assets/<slug>/recommendations.json for the static demo to
replay as a fake stream (see demoClient.ts's streamCodeHealthRecommendations).
Reuses whatever dependency-risk.json build_demo_fixtures.py already wrote for
each slug (if it found real vulnerabilities) so the recommendation text can
reference them, exactly like a real session that scanned dependencies first
would.

Requires `ollama serve` running locally with qwen2.5-coder:3b pulled, and
should be run after build_demo_fixtures.py (which parses each repo and
produces dependency-risk.json).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from build_demo_fixtures import (  # noqa: E402
    PYTHON_SHOP_PATH,
)
from fastapi.testclient import TestClient  # noqa: E402

from semantic_vision.api.app import create_app  # noqa: E402

OUT_ROOT = REPO_ROOT / "frontend" / "demo-assets"
MODEL = "qwen2.5-coder:3b"

LANGUAGE_BY_SLUG = {"python-shop": "python", "axios": "javascript", "guava-base": "java"}


def load_dependency_risks(slug: str) -> list[dict] | None:
    fixture_path = OUT_ROOT / slug / "dependency-risk.json"
    if not fixture_path.exists():
        return None
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    if not data.get("available") or not data.get("risks"):
        return None
    return data["risks"]


def generate_recommendations(client: TestClient, *, slug: str, repo_path: str) -> None:
    language = LANGUAGE_BY_SLUG[slug]
    client.post(
        "/api/parse-repo", json={"path": repo_path, "language": language}
    ).raise_for_status()

    dependency_risks = load_dependency_risks(slug)
    print(f"generating recommendations for {slug} ...", end=" ", flush=True)
    resp = client.post(
        "/api/code-health/recommendations",
        params={"path": repo_path, "language": language},
        json={"provider": "ollama", "model": MODEL, "dependency_risks": dependency_risks},
    )
    if resp.status_code != 200:
        print(f"FAILED ({resp.status_code}): {resp.text[:200]}")
        return
    markdown = resp.text
    print(f"ok ({len(markdown)} chars)")

    out_path = OUT_ROOT / slug / "recommendations.json"
    out_path.write_text(json.dumps({"markdown": markdown}, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--js-repo", default=str(Path.home() / "AppData/Local/Temp/sv-demo-src/axios/lib")
    )
    parser.add_argument(
        "--java-repo",
        default=str(
            Path.home() / "AppData/Local/Temp/sv-demo-src/guava/guava/src/com/google/common/base"
        ),
    )
    args = parser.parse_args()
    js_repo = Path(args.js_repo)
    java_repo = Path(args.java_repo)

    app = create_app()
    client = TestClient(app)

    generate_recommendations(client, slug="python-shop", repo_path=str(PYTHON_SHOP_PATH))

    if js_repo.exists():
        generate_recommendations(client, slug="axios", repo_path=str(js_repo))
    else:
        print(f"Skipping axios recommendations -- {js_repo} not found")

    if java_repo.exists():
        generate_recommendations(client, slug="guava-base", repo_path=str(java_repo))
    else:
        print(f"Skipping guava-base recommendations -- {java_repo} not found")


if __name__ == "__main__":
    main()
