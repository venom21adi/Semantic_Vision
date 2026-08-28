# Benchmarks

Real-world load-performance results for Semantic Vision (v0.2.0), one repo per supported
language, against genuinely large, well-known open-source codebases — not this project's own
fixtures. Each repo is downloaded fresh, pointed at unmodified, and measured through the same two
tiers: the backend parse/API round trip, and a real browser load through the actual running app
(Playwright-driven, not simulated).

This folder is a published summary, not a development log. For the iteration-by-iteration
optimization history behind these numbers (root causes, fixes, regressions caught and corrected
along the way), see this project's internal `docs/PERFORMANCE-REPORT.md`.

## Results

Three comparable repos — similar scale, similar (nested, not flat) directory shape — one per
supported language:

| Language | Repo | Scope | Files | Nodes | Edges | Parse errors | Backend parse — cold (s) | Backend parse — warm (s) | API round trip (s) | Browser: time to data (s) | Browser: time to render (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Python | [fastapi/fastapi](fastapi.md) | full repo | 1,138 | 6,650 | 25,145 | 0 | 23.25 | 4.08 | 9.29 | 6.58–7.07 | 7.20–7.84 |
| JavaScript | [three.js](threejs.md) | `src/` only | 752 | 6,014 | 27,316 | 0 | 29.33 | 1.98 | 3.12 | 3.21–3.50 | 4.88–5.01 |
| TypeScript | [nestjs/nest](nest.md) | full repo | 1,907 | 6,848 | 24,528 | 2 | 39.68 | 2.48 | 5.32 | 5.69–5.76 | 6.85–6.88 |

*"Backend parse — cold" is the first read of a fresh shallow clone at the pinned commit (below),
never before touched by this machine's OS file cache. "— warm" is a second parse of the exact same
files immediately after, same process, same clone — the only variable that changes is cache state.
See [Methodology](#methodology) for why this pair replaced a single, cache-state-ambiguous number.
"API round trip" is `POST /api/parse-repo`, the full backend-parse-plus-cache path a repo load
actually pays — **not** re-verified under the cold/warm methodology below; treat its exact cache
state, and the browser columns', as unknown (most likely warm, by the same reasoning documented in
[nest.md](nest.md), but not confirmed the way the parse columns now are). "Browser: time to render"
is measured from clicking Load in a real Chromium tab to the first graph node actually painting —
the number that matters to a person waiting on the page, not just the backend.*

Click through to each repo's page for what it is, why it was picked, and what's notable about its
numbers specifically — the three don't all tell the same story.

**The headline takeaway:** once cache state is controlled for, there's no cross-language outlier.
Every language shows a large cold/warm gap (5.7x–16x) — it's a general effect of reading hundreds
of files off disk for the first time, not something specific to any one parser or grammar. Warm,
TypeScript (nest, 2.48s) actually parses *faster* than Python (fastapi, 4.08s). Cold, nest is the
highest of the three (39.68s vs. 23–29s) — but nest also has the most files (1,907 vs. 752–1,138),
a plausible, unremarkable explanation that doesn't require inventing a TypeScript-specific cause.

## Case study: when the default view doesn't collapse much

**[webpack/webpack](webpack.md)** was the original JavaScript pick, and its numbers are real, but
its `lib/` directory turned out to be unusually flat — 157 items sitting directly at the top
level, instead of the handful a normally-nested repo produces (three.js's `src/` has 24; FastAPI
and nest each have well under 10). That single structural fact, not JavaScript itself, is what
made its browser render time ~57s instead of ~5-7s — and digging into *why* surfaced two genuine,
confirmed root causes (one performance, one a real parser correctness bug) worth publishing on
their own. Kept out of the main comparison above so it doesn't skew "JavaScript" numbers with a
structural edge case, but the investigation is a genuinely useful read — see
[webpack.md](webpack.md). Backend parse for webpack/`lib/`, same cold/warm methodology as the main
table: **27.40s cold, 3.04s warm** — the same universal cache effect, not a webpack-specific cost.

**Update**: the complexity-index performance bug this investigation found (`ts_locate.py`/
`ast_locate.py` re-walking a whole file's syntax tree per function lookup) has since been fixed
on branch `perf/js-ts-def-lookup`, along with the getter/setter node-id collision bug found
alongside it — see the "Fixed" notes in [webpack.md](webpack.md), [threejs.md](threejs.md),
[nest.md](nest.md), and [fastapi.md](fastapi.md) for before/after numbers on each repo. The
checkbox-click render-time cost (the other half of webpack's outlier) has since been substantially
reduced — see `frontend/src/graph/collapseDirectories.ts`'s parent-structure cache (Milestone 18).

## Methodology

- **Backend/API tier**: `scripts/benchmark_repo_load.py`, run against a local backend
  (`uv run uvicorn semantic_vision.api.app:app`). Measures raw parse time, the lazy
  complexity-index build, and the full `POST /api/parse-repo` / `GET /api/graph` round trip.
- **Browser tier**: `frontend/scripts/benchmark-load.js`, a real Playwright-driven Chromium load
  against the actual running app (`localhost:5173` + `localhost:8000`) — not a simulation. For a
  repo above the app's 300-node large-graph threshold, the canvas starts with nothing selected by
  design; the script checks every top-level sidebar item before timing the render, the same
  action a person opening a large repo would take.
- Both scripts accept `--language python|javascript` (one adapter covers JS/TS/JSX/TSX together)
  and `--no-report`, which was used throughout so this folder's own runs never touched the
  project's internal `docs/PERFORMANCE-REPORT.md`.
- Each number above is the range across two consecutive runs on the same machine, immediately
  after each other. Absolute numbers will vary machine to machine and with ambient system load —
  treat these as indicative, not a guaranteed SLA, consistent with how this project's internal
  performance report already treats its own numbers.

### Cold vs. warm backend parse (added after the original publish)

The original single "Backend parse" number for nest (53.71s) turned out to be a first-ever read of
a freshly-cloned repo, ~10x slower than a same-machine re-parse moments later (5.32s) -- while
fastapi's and three.js's original numbers carried no equivalent cache-state disclosure at all, so
the three weren't actually comparable to begin with. Rather than guess, all four repos (including
webpack's case study) were re-benchmarked under one explicit, reproducible procedure:

1. Shallow-clone the repo fresh (`git init && git remote add && git fetch --depth 1 origin <sha> &&
   git checkout FETCH_HEAD`) at the exact pinned commit in
   [Repo versions benchmarked](#repo-versions-benchmarked) below, into a directory this machine has
   never read before -- this is the **cold** measurement, run once.
2. Immediately parse the identical clone a second time, same process, no server cache involved
   (`scripts/benchmark_repo_load.py` calls `parse_repository` directly) -- this is the **warm**
   measurement, isolating cache state as the only variable that changed.

This confirmed the effect is universal, not TypeScript-specific -- every language showed a 5.7x to
16x cold/warm gap -- and that the complexity-index build (a pure in-memory computation over an
already-parsed AST, no new disk reads) is correctly cache-*insensitive*: fastapi's 2.66s cold vs.
2.87s warm, three.js's 2.92s vs. 2.98s, webpack's 5.64s vs. 5.59s, nest's 1.90s vs. 1.94s -- all
within normal run-to-run noise, exactly as expected for a step that does no I/O. The `API round
trip` and browser-tier columns above were **not** re-run under this controlled procedure (out of
scope for this pass) and should be read with that caveat.

## Repo selection and scope notes

Every repo here except nest required a scoping decision, made explicit rather than silent:

- **webpack** (case study, not the main JS entry) is benchmarked against `lib/` (718 files) only,
  not the full repo (13,839 files). The rest is almost entirely webpack's own test-fixture suite —
  tiny synthetic bundles used to test the bundler itself, some deliberately malformed to test
  error handling (202 parse errors on the full repo, 1 on `lib/` alone).
- **three.js** is benchmarked against `src/` (752 files) — its real source. `test/`, `examples/`,
  `docs/`, and `manual/` all live outside `src/` at the repo root, so pointing at `src/` directly
  excludes them without needing to cherry-pick further.
- **nest** is benchmarked against the full repo (1,907 files, including its own spec/integration
  tests) — no equivalent bloat problem, so no scoping was needed. `microsoft/TypeScript` was the
  original TypeScript pick, but its real compiler source turned out to be only 130 files
  (34.5k lines); the rest of that repo is compiler test fixtures. Swapped to `nestjs/nest` for a
  fairer scale match to the other two.

## Repo versions benchmarked

| Repo | Commit | Date |
|---|---|---|
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | `c3f316b7e814667e8ee81e03a7330d00ee61e45c` | 2026-08-19 |
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | `3744db754b77106a4b2921fcc0a77f0964b823a7` | 2026-08-27 |
| [nestjs/nest](https://github.com/nestjs/nest) | `cd5ee129162d1d4b9cccfaf2def4cfb051bfe927` | 2026-08-28 |
| [webpack/webpack](https://github.com/webpack/webpack) (case study) | `0b2952e15bb1aa9a198acbbfdcb9a0dc1aabb5af` | 2026-08-27 |

Benchmarked 2026-08-28 against Semantic Vision v0.2.0.
