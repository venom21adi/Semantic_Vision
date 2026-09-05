"""Generates real AI documentation for the demo repos' showcase functions.

Uses the actual /api/generate-doc code path (local Ollama, qwen2.5-coder:3b)
against the two demo repos, and writes the resulting markdown into
frontend/public/demo/<slug>/docs.json for the static demo to replay as a
fake stream (see build_demo_fixtures.py's *_SHOWCASE_DOCS lists, which this
script reuses so the two stay in sync).

Requires `ollama serve` running locally with qwen2.5-coder:3b pulled.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from fastapi.testclient import TestClient  # noqa: E402

from semantic_vision.api.app import create_app  # noqa: E402
from build_demo_fixtures import (  # noqa: E402
    AXIOS_SHOWCASE_DOCS,
    PYTHON_SHOP_PATH,
    PYTHON_SHOP_SHOWCASE_DOCS,
)

OUT_ROOT = REPO_ROOT / "frontend" / "public" / "demo"
MODEL = "qwen2.5-coder:3b"


def generate_docs(client: TestClient, *, slug: str, repo_path: str, ids: list[str]) -> None:
    language = "python" if slug == "python-shop" else "javascript"
    client.post("/api/parse-repo", json={"path": repo_path, "language": language}).raise_for_status()

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
    js_repo = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path.home() / "AppData/Local/Temp/sv-demo-src/axios/lib"
    )

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


if __name__ == "__main__":
    main()
