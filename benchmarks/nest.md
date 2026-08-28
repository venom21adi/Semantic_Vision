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
| Backend parse | 53.71s |
| Complexity index build | ~~7.51s~~ **1.88–2.05s, fixed — see below** |
| `POST /api/parse-repo` | 5.32s |
| `GET /api/graph` | 0.17s |
| Graph payload | 5,883.7 KB |
| Browser: time to data | 5.69–5.76s |
| Browser: time to render | 6.85–6.88s |

## Notes

Backend parse (53.71s, measured directly via `parse_repository`, the first-ever read of this
freshly-cloned repo's files) is notably slower than FastAPI's 5.79s or webpack `lib/`'s 4.89s,
despite a comparable-to-smaller node count than webpack. Observed directly, not root-caused here
— a candidate factor is TypeScript's heavier use of decorators and type-only syntax (both central
to NestJS's design) potentially costing more per file in the `tree-sitter-typescript` grammar than
plain JavaScript does, but this wasn't confirmed.

That cost doesn't reappear downstream: `POST /api/parse-repo` (5.32s) re-parses the same files a
few seconds later through the live backend server and is roughly 10x faster than the direct call
above — most plausibly the OS's own file cache warming between two back-to-back reads of the same
1,907 files, not this app's own repo cache (which returns in well under a second, not 5.32s, once
a path is actually cached). Browser render (6.85–6.88s) is in line with FastAPI and well ahead of
webpack's `lib/`. Since first published, this repo has been re-benchmarked (see below) with a
fully warm OS file cache: backend parse landed at 2.40s, consistent with the cold-cache theory
above rather than anything TypeScript-specific — kept here as the original, honestly-reported
first-run number rather than quietly revised away.

**Complexity-index build fixed** (branch `perf/js-ts-def-lookup`): same root cause and fix as
[webpack.md](webpack.md#complexity-index-build--was-12813s-now-543583s-fixed) and
[threejs.md](threejs.md) — `ts_locate.find_def_node` re-walking a whole file's tree per function
lookup, now a build-once-per-file index instead. Re-benchmarked on the same repo/commit: **1.88s
and 2.05s** across two runs, a ~4x improvement (smaller than webpack's ~23x since nest has no
comparably huge single files — consistent with the fix's cost model being file-size-driven).
