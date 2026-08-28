# fastapi/fastapi (Python)

[FastAPI](https://github.com/fastapi/fastapi) — one of the most widely used Python web
frameworks, chosen as the Python stress test both for its scale and because it's a real,
actively-maintained production codebase rather than a synthetic benchmark repo.

Benchmarked at commit `c3f316b7e814667e8ee81e03a7330d00ee61e45c` (2026-08-19), full repo, no
scoping needed — no test-fixture bloat problem here (its own `tests/` and `docs_src/` are
included in the numbers below, same as a real user pointing Semantic Vision at the repo as
downloaded).

## Results

| Metric | Value |
|---|---|
| Files | 1,138 |
| Nodes | 6,650 |
| Edges | 25,145 |
| Parse errors | 0 |
| Backend parse | 5.79s |
| Complexity index build | 3.41s |
| `POST /api/parse-repo` | 9.29s |
| `GET /api/graph` | 0.14s |
| Graph payload | 5,562.0 KB |
| Browser: time to data | 6.58–7.07s |
| Browser: time to render | 7.20–7.84s |

## Notes

Zero parse errors on a real, unmodified third-party codebase. Browser render time (7.20–7.84s) is
barely above time-to-data (6.58–7.07s) — once the graph data arrives, layout and paint add well
under a second, the expected shape for a repo this size after this project's own large-graph
collapse-by-default work.

**Complexity-index build**: the same `ast_locate.py`/`ts_locate.py` indexing fix documented in
[webpack.md](webpack.md#complexity-index-build--was-12813s-now-543583s-fixed) applies to Python
too (`ast_locate.py` had the identical unconditional-full-walk shape). Re-benchmarked on the same
repo/commit: 2.64–2.94s, modestly down from 3.41s — a real but small improvement, as expected:
FastAPI has no comparably huge, function-dense single files, so it was never hitting this cost
hard to begin with. Consistent with the fix's cost model being file-size-driven, not
language-specific.
