#!/usr/bin/env python3
"""Benchmarks repo-load performance: backend parse time and complexity-
index build time (always run -- import `semantic_vision` directly, no
server needed), plus full API round-trip time (if a backend server is
reachable at `API_BASE_URL`), across a configurable set of repos -- so
performance-optimization iterations (Milestone 18,
`docs/PHASE-2-BUILD-PLAN.md`) have consistent, comparable numbers
instead of one-off eyeballed measurements.

Usage (from the repo root):

    uv run python scripts/benchmark_repo_load.py \\
        --repo small=tests/fixtures/simple_repo \\
        --repo medium=. \\
        --repo "large=C:/AI_Voice/TTS/TTS"

With no --repo given, benchmarks this project's own small `simple_repo`
fixture and this repo itself as quick built-in reference points. A
--repo path outside this repository (e.g. a large external codebase
you're using as a stress test) is always passed explicitly -- it's
machine-specific and never hardcoded here.

The API tier is skipped automatically, with a note in the output, if
http://localhost:8000 isn't reachable -- start it first (see README's
Quick start) to include that tier.

Results print as a table to stdout and are appended to
docs/PERFORMANCE-REPORT.md as a new, timestamped section. Run this
after every optimization pass and keep the updated report alongside
the code change, per this project's "track KPIs over iterations"
convention for this milestone.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from semantic_vision.analysis.complexity import build_complexity_index  # noqa: E402
from semantic_vision.models import NodeKind  # noqa: E402
from semantic_vision.repo_parser import parse_repository  # noqa: E402

try:
    import httpx
except ImportError:
    httpx = None

API_BASE_URL = "http://localhost:8000"
REPORT_PATH = Path(__file__).resolve().parent.parent / "docs" / "PERFORMANCE-REPORT.md"


@dataclass
class RepoResult:
    label: str
    path: str
    file_count: int
    node_count: int
    edge_count: int
    parse_error_count: int
    parse_seconds: float
    complexity_index_seconds: float
    api_parse_seconds: float | None = None
    api_graph_seconds: float | None = None
    api_graph_payload_bytes: int | None = None


def benchmark_backend(label: str, path: str) -> RepoResult:
    resolved = Path(path).resolve()

    start = time.perf_counter()
    result = parse_repository(str(resolved))
    parse_seconds = time.perf_counter() - start

    # Counted from the actual parse result, not a raw filesystem walk --
    # a naive `rglob("*.py")` would also pick up `.venv`/`node_modules`
    # packages that the parser's own discovery correctly excludes,
    # wildly inflating this number for a repo with a local venv.
    file_count = sum(1 for n in result.nodes if n.kind == NodeKind.FILE)

    # Built synchronously inside `RepoCache.set()` as part of every
    # `POST /api/parse-repo` call since Milestone 9 -- timed separately
    # here so its cost isn't invisibly folded into "parsing" if it turns
    # out to matter on a large repo (it re-walks each function's AST a
    # second time via `ast_locate.locate`, on top of the original parse).
    start = time.perf_counter()
    build_complexity_index(result)
    complexity_seconds = time.perf_counter() - start

    return RepoResult(
        label=label,
        path=str(resolved),
        file_count=file_count,
        node_count=len(result.nodes),
        edge_count=len(result.edges),
        parse_error_count=len(result.parse_errors),
        parse_seconds=parse_seconds,
        complexity_index_seconds=complexity_seconds,
    )


def backend_reachable(client: httpx.Client) -> bool:
    try:
        resp = client.get("/api/health", timeout=3)
        return resp.status_code == 200
    except Exception:
        return False


def benchmark_api(result: RepoResult, client: httpx.Client) -> None:
    start = time.perf_counter()
    resp = client.post("/api/parse-repo", json={"path": result.path}, timeout=600)
    resp.raise_for_status()
    result.api_parse_seconds = time.perf_counter() - start

    start = time.perf_counter()
    resp = client.get("/api/graph", params={"path": result.path}, timeout=600)
    resp.raise_for_status()
    result.api_graph_seconds = time.perf_counter() - start
    result.api_graph_payload_bytes = len(resp.content)


def format_table(results: list[RepoResult]) -> str:
    headers = [
        "Repo",
        "Files",
        "Nodes",
        "Edges",
        "Parse errors",
        "Backend parse (s)",
        "Complexity index (s)",
        "API parse-repo (s)",
        "API graph (s)",
        "Graph payload (KB)",
    ]
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    for r in results:
        lines.append(
            "| "
            + " | ".join(
                [
                    r.label,
                    str(r.file_count),
                    str(r.node_count),
                    str(r.edge_count),
                    str(r.parse_error_count),
                    f"{r.parse_seconds:.2f}",
                    f"{r.complexity_index_seconds:.2f}",
                    f"{r.api_parse_seconds:.2f}" if r.api_parse_seconds is not None else "—",
                    f"{r.api_graph_seconds:.2f}" if r.api_graph_seconds is not None else "—",
                    f"{r.api_graph_payload_bytes / 1024:.1f}"
                    if r.api_graph_payload_bytes is not None
                    else "—",
                ]
            )
            + " |"
        )
    return "\n".join(lines)


def append_to_report(results: list[RepoResult]) -> None:
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    section = f"\n### {timestamp} — backend/API benchmark\n\n{format_table(results)}\n"
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open("a", encoding="utf-8") as f:
        f.write(section)


def parse_repo_args(raw: list[str]) -> list[tuple[str, str]]:
    pairs = []
    for item in raw:
        label, _, path = item.partition("=")
        if not path:
            raise SystemExit(f"--repo must be label=path, got: {item!r}")
        pairs.append((label, path))
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        action="append",
        default=[],
        metavar="LABEL=PATH",
        help="A repo to benchmark, e.g. --repo large=C:/path/to/repo. Repeatable.",
    )
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="Print results only -- don't append to docs/PERFORMANCE-REPORT.md.",
    )
    args = parser.parse_args()

    repos = parse_repo_args(args.repo) or [
        ("small", "tests/fixtures/simple_repo"),
        ("medium", "."),
    ]

    results = [benchmark_backend(label, path) for label, path in repos]

    if httpx is None:
        print("httpx not installed -- skipping API tier (backend-only numbers below).")
    else:
        with httpx.Client(base_url=API_BASE_URL) as client:
            if backend_reachable(client):
                for r in results:
                    benchmark_api(r, client)
            else:
                print(f"No backend reachable at {API_BASE_URL} -- skipping API tier.")
                print("Start it with: uv run uvicorn semantic_vision.api.app:app --port 8000\n")

    table = format_table(results)
    print(table)

    if not args.no_report:
        append_to_report(results)
        print(f"\nAppended to {REPORT_PATH}")


if __name__ == "__main__":
    main()
