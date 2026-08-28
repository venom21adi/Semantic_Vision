# nestjs/nest (TypeScript)

[NestJS](https://github.com/nestjs/nest) — a widely used progressive Node.js framework, written
entirely in TypeScript, chosen as the TypeScript stress test after the original pick
(`microsoft/TypeScript`, the compiler itself) turned out to have only 130 files of real compiler
source underneath a much larger test-fixture suite — see the
[main README](README.md#repo-selection-and-scope-notes) for that swap.

Benchmarked at commit `cd5ee129162d1d4b9cccfaf2def4cfb051bfe927` (2026-08-28), full repo (1,907
files, including its own spec/integration tests) — no scoping needed, no fixture-bloat problem
here.

## Results

| Metric | Value |
|---|---|
| Files | 1,907 |
| Nodes | 6,848 |
| Edges | 24,528 |
| Parse errors | 2 |
| Backend parse — cold | ~~53.71s~~ **39.68s, re-measured under controlled cold-cache conditions — see below** |
| Backend parse — warm | 2.48s |
| Complexity index build | ~~7.51s~~ **1.88–2.05s, fixed — see below** |
| `POST /api/parse-repo` | 5.32s |
| `GET /api/graph` | 0.17s |
| Graph payload | 5,883.7 KB |
| Browser: time to data | 5.69–5.76s |
| Browser: time to render | 6.85–6.88s |

## Notes

Backend parse (53.71s, measured directly via `parse_repository`, the first-ever read of this
freshly-cloned repo's files) was originally notably slower than FastAPI's 5.79s or webpack
`lib/`'s 4.89s, despite a comparable-to-smaller node count than webpack, and not root-caused at
first publish beyond an unconfirmed guess (TypeScript's heavier decorator/type-only syntax costing
more per file in the `tree-sitter-typescript` grammar).

That cost didn't reappear downstream: `POST /api/parse-repo` (5.32s) re-parsed the same files a
few seconds later through the live backend server, roughly 10x faster than the direct call above
— pointing at the OS's own file cache warming between two back-to-back reads of the same 1,907
files, not this app's own repo cache (which returns in well under a second, not 5.32s, once a path
is actually cached). Browser render (6.85–6.88s) is in line with FastAPI and well ahead of
webpack's `lib/`.

**Root-caused and confirmed** (not just theorized): this repo, along with fastapi, three.js, and
webpack's `lib/`, was re-benchmarked under one explicit, controlled procedure — a fresh shallow
clone at the exact commit below (never read by this machine before, the **cold** number) followed
immediately by a second parse of the identical files (the **warm** number). Results: **39.68s
cold, 2.48s warm** — a real, large, but entirely explainable-by-cache-state gap, and *not*
TypeScript-specific: every language in the comparison (see
[the main README](README.md#cold-vs-warm-backend-parse-added-after-the-original-publish)) showed
the same 5.7x–16x cold/warm swing, including Python. Warm-to-warm, this repo (2.48s) is actually
*faster* than fastapi's own warm number (4.08s) — the original headline "TypeScript is ~10x
slower" reading doesn't survive controlling for cache state. Kept the original 53.71s figure
struck through above (rather than deleted) so this remains an honestly-reported correction, not a
quietly revised number.

**Complexity-index build fixed** (branch `perf/js-ts-def-lookup`): same root cause and fix as
[webpack.md](webpack.md#complexity-index-build--was-12813s-now-543583s-fixed) and
[threejs.md](threejs.md) — `ts_locate.find_def_node` re-walking a whole file's tree per function
lookup, now a build-once-per-file index instead. Re-benchmarked on the same repo/commit: **1.88s
and 2.05s** across two runs, a ~4x improvement (smaller than webpack's ~23x since nest has no
comparably huge single files — consistent with the fix's cost model being file-size-driven).
