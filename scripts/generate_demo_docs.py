"""Generates real AI documentation for the demo repos' showcase functions.

Uses the actual /api/generate-doc code path (local Ollama, qwen2.5-coder:3b)
against the demo repos, and writes the resulting markdown into
frontend/demo-assets/<slug>/docs.json for the static demo to replay as a
fake stream (see build_demo_fixtures.py's *_SHOWCASE_DOCS lists, which this
script reuses so the two stay in sync).

Requires `ollama serve` running locally with qwen2.5-coder:3b pulled.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from build_demo_fixtures import (  # noqa: E402
    AXIOS_SHOWCASE_DOCS,
    JAVA_BASE_SHOWCASE_DOCS,
    PYTHON_SHOP_PATH,
    PYTHON_SHOP_SHOWCASE_DOCS,
)
from fastapi.testclient import TestClient  # noqa: E402

from semantic_vision.api.app import create_app  # noqa: E402

OUT_ROOT = REPO_ROOT / "frontend" / "demo-assets"
MODEL = "qwen2.5-coder:3b"

LANGUAGE_BY_SLUG = {"python-shop": "python", "axios": "javascript", "guava-base": "java"}


def generate_docs(client: TestClient, *, slug: str, repo_path: str, ids: list[str]) -> None:
    language = LANGUAGE_BY_SLUG[slug]
    client.post(
        "/api/parse-repo", json={"path": repo_path, "language": language}
    ).raise_for_status()

    docs: dict[str, str] = {}
    for node_id in ids:
        print(f"generating doc for {slug}::{node_id} ...", end=" ", flush=True)
        resp = client.post(
            "/api/generate-doc",
            params={"path": repo_path, "id": node_id},
            json={"provider": "ollama", "model": MODEL},
        )
        if resp.status_code != 200:
            print(f"FAILED ({resp.status_code}): {resp.text[:200]}")
            continue
        markdown = resp.text
        docs[node_id] = markdown
        print(f"ok ({len(markdown)} chars)")

    out_path = OUT_ROOT / slug / "docs.json"
    out_path.write_text(json.dumps(docs, indent=2), encoding="utf-8")
    print(f"wrote {out_path} ({len(docs)} docs)")


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

    generate_docs(
        client,
        slug="python-shop",
        repo_path=str(PYTHON_SHOP_PATH),
        ids=PYTHON_SHOP_SHOWCASE_DOCS,
    )

    if js_repo.exists():
        generate_docs(client, slug="axios", repo_path=str(js_repo), ids=AXIOS_SHOWCASE_DOCS)
    else:
        print(f"Skipping axios docs -- {js_repo} not found")

    if java_repo.exists():
        generate_docs(
            client, slug="guava-base", repo_path=str(java_repo), ids=JAVA_BASE_SHOWCASE_DOCS
        )
    else:
        print(f"Skipping guava-base docs -- {java_repo} not found")


if __name__ == "__main__":
    main()
