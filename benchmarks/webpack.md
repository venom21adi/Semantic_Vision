# webpack/webpack (JavaScript)

[webpack](https://github.com/webpack/webpack) — the module bundler used by a large share of the
JavaScript ecosystem, chosen as the JavaScript stress test for its scale and real-world density
of cross-file imports and calls.

Benchmarked at commit `0b2952e15bb1aa9a198acbbfdcb9a0dc1aabb5af` (2026-08-27), scoped to `lib/`
(718 files) — webpack's real source. The full repo is 13,839 files; almost all of the rest is
webpack's own test-fixture suite (tiny synthetic bundles used to test the bundler itself, some
deliberately malformed to exercise error handling — 202 parse errors resulted from parsing the
full repo, versus 1 on `lib/` alone). See the [main README](README.md#repo-selection-and-scope-notes)
for why this scoping was applied.

## Results

| Metric | Value |
|---|---|
| Files | 718 |
| Nodes | 6,466 |
| Edges | 42,031 |
| Parse errors | 1 |
| Backend parse | 4.89s |
| Complexity index build | 128.13s |
| `POST /api/parse-repo` | 5.76s |
| `GET /api/graph` | 0.13s |
| Graph payload | 7,746.8 KB |
| Browser: time to data | 7.74–7.90s |
| Browser: time to render | 56.71–58.39s |

## Notes

Two real outliers here, both observed directly rather than assumed, neither root-caused as part
of this benchmarking pass:

- **Complexity-index build (128.13s)** is far above FastAPI's 3.41s or nest's 7.51s, despite a
  comparable node count. `lib/`'s edge count (42,031, on only 6,466 nodes) is the highest density
  of any repo in this set — 6.5 edges per node, versus ~3.6–3.8 for the other two — consistent
  with a highly interconnected, deeply cross-referenced codebase, but not confirmed as the actual
  cause of the complexity-index cost specifically.
- **Browser render time (56.71–58.39s)** is far above the other two repos' ~7s. `lib/`, passed
  directly as the parse root, is itself a flat directory with 157 items one level deep — so the
  app's large-graph collapse-by-default view still starts with 157 visible top-level boxes here,
  not the handful a more nested directory structure produces (FastAPI and nest both collapse to a
  much smaller top-level view). More visible nodes plus this repo's unusually dense edge graph is
  the likely explanation, not confirmed further here.

Both are genuine, reproducible characteristics of this specific codebase's shape, not benchmark
noise — each number above is consistent across two runs (128.13s complexity index measured once;
render time 56.71s and 58.39s across two separate runs).
