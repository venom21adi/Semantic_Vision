# webpack/webpack (JavaScript) — case study

[webpack](https://github.com/webpack/webpack) — the module bundler used by a large share of the
JavaScript ecosystem. This was the original JavaScript pick for the main 3-language comparison,
but its `lib/` directory turned out to be unusually flat (157 items one level deep), which made
its render time an outlier for structural reasons unrelated to JavaScript itself — see
[the main README](README.md#case-study-when-the-default-view-doesnt-collapse-much). Moved here as
a standalone case study; [three.js](threejs.md) replaced it as the comparison's JavaScript entry.
Kept because digging into *why* it was slow surfaced two genuine, confirmed root causes below —
one real performance bug, one real correctness bug — worth documenting regardless of which repo
represents "JavaScript" in the headline comparison.

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
| Backend parse (original, cache state undisclosed) | 4.89s |
| Backend parse — cold | 27.40s |
| Backend parse — warm | 3.04s |
| Complexity index build | ~~128.13s~~ **5.43–5.83s, fixed — see below** |
| `POST /api/parse-repo` | 5.76s |
| `GET /api/graph` | 0.13s |
| Graph payload | 7,746.8 KB |
| Browser: time to data | 7.74–7.90s |
| Browser: time to render | 56.71–58.39s |

## Root cause

Both outliers below were profiled directly, not left as unconfirmed observations — an earlier
version of this page guessed at "more visible nodes plus a dense edge graph" for the render-time
outlier specifically; that guess was wrong, and is corrected below.

### Complexity-index build — was 128.13s, now 5.43–5.83s (fixed)

Confirmed via `cProfile` against `build_complexity_index` on this exact repo:
`ts_locate.find_def_node` (which re-locates a JS/TS function's exact tree-sitter node from its
graph entry) does a full, unconditional recursive walk of its *entire owning file's* syntax tree,
for *every single function* being located — no caching between lookups in the same file, no
early exit. For a file with F functions and N tree-sitter nodes, that's O(F × N) node visits.

`lib/` has a handful of unusually large, function-dense files — `css/syntax.js` (13,502 lines,
331 functions) and `html/syntax.js` (13,508 lines, 236 functions) chief among them. Profiling
confirms these dominate: `find_def_node`'s inner `walk` was called **44,541,433 times** across
only 5,025 function lookups (~8,864 tree-node visits per lookup, on average), accounting for
~170s of a ~177s profiled run (a separate run from the 128.13s in the table above; both runs
agree on what dominates, run-to-run variance aside).

This was a real, fixable inefficiency in `ts_locate.py`, not a "JS parsing is inherently slow"
story — Python's equivalent (`ast_locate.py`) has the identical unconditional-full-walk shape,
but FastAPI has no comparably large, function-dense single files, so it never exercised this
path.

**Fixed** (branch `perf/js-ts-def-lookup`): both `ts_locate.py` and `ast_locate.py` now build a
`(line, name) -> node` index once per file, on first lookup, instead of re-walking the whole tree
per function. Re-benchmarked on the exact same repo/commit after the fix: **5.43s and 5.83s**
across two runs — a ~23x improvement, and the fix helps every JS/TS (and Python) repo with large
files, not just this one. See [threejs.md](threejs.md) and [nest.md](nest.md) for the same fix's
effect at a less extreme scale (both had smaller but real versions of this same cost).

### Backend parse — cold vs. warm

The original 4.89s figure never disclosed its OS-file-cache state. Re-benchmarked (alongside
fastapi, three.js, and nest) under a controlled procedure — a fresh shallow clone at the exact
commit below, parsed once (**27.40s cold**), then parsed again immediately on the identical files
(**3.04s warm**). Same universal cold/warm effect seen across every language in this comparison,
including Python — see
[the main README](README.md#cold-vs-warm-backend-parse-added-after-the-original-publish).

### Browser render time (56.71–58.39s)

Isolated each stage independently against this exact repo, bypassing the browser entirely for the
first two:

| Stage | Time |
|---|---|
| `buildVisibleGraph` (collapse/aggregate 6,466 raw nodes → 157 visible) | 0.04s |
| `dagre.layout()` on the resulting 157-node view | 0.03s |
| Checking all 157 top-level "show on canvas" checkboxes (real browser, via Playwright) | **~24s** |

`dagre` and the collapse/aggregation logic are not the bottleneck — both are effectively instant.
The real cost is in checking the checkboxes: timed individually, **every one of the 157 clicks
costs 100–400ms** (average 151ms), not the near-zero cost a single batched update would produce.
This isn't webpack-specific — any repo whose default collapsed view has many top-level items pays
this same per-click cost. `lib/`, passed directly as the parse root, happens to have 157 items one
level deep (FastAPI and nest each have well under 10), so it's the only repo in this set where the
cost is large enough to see.

A second, independently real finding surfaced during this same measurement: React logged **2,385
"duplicate key" warnings** while clicking through the tree — a genuine parser bug, not benchmark
noise. `javascript_extractor.py`'s `_extract_class` named a class's `get foo()` and `set foo(v)`
identically (`_member_name` reads only the method's name field, never tree-sitter's `kind` field
— which, confirmed by direct inspection while fixing this, doesn't actually exist on this
grammar's `method_definition` node at all; `get`/`set` show up as an unnamed leading child token
instead) — so a getter/setter pair for the same property collapsed into one node id downstream.
Confirmed live against real webpack methods (`Module.js::Module.issuer`,
`ExportsInfo.js::ExportInfo.canInlineProvide`, and dozens more). This was a correctness bug
independent of performance — it silently merged two distinct methods' impact analysis, complexity
score, and AI docs into one node, for any JS/TS class with a getter/setter pair, not just at
large-repo scale.

**Fixed** (same branch): the extractor now reads the `get`/`set` marker and threads it through as
`RawFunction.accessor_kind`; `resolver/symbol_table.py` appends a `#get`/`#set` suffix to the node
id only when that's set, so `Module.js::Module.issuer#get` and `Module.js::Module.issuer#set` are
now two distinct nodes instead of one silently overwriting the other — node identity, complexity
score, and AI docs are all correctly separated now. `label` deliberately stays the bare method name
(unchanged) — `ts_locate`'s matching is by line + label against the extractor's own plain-name
output, so changing it would have broken re-locating exactly the nodes this fixes.

One more collision surfaced (and fixed) by an adversarial review of this change before it landed:
`resolver/symbol_table.py`'s *other* method index (`ModuleIndex.methods`, keyed by plain
`(class, method)` name — backs the `this.foo()`/`ClassName.foo()` call-resolution shorthand in
`resolver/calls.py`) still collided the two accessors even after the node-id fix above. Since the
two accessors are now genuinely distinct nodes, that collision had gotten *worse*, not better: a
call like `this.value()` now confidently resolved to whichever accessor happened to be registered
last, silently wrong, instead of the old behavior (both sharing one id, so any resolution was
trivially "correct" by construction). Fixed by removing a name from that shorthand index entirely
once a second, distinct method claims it — `resolver/calls.py` then falls through to its existing
unresolved/ambiguous-edge path for that call, same as any other call it can't confidently resolve,
rather than guessing.

**Root-caused (Milestone 18, `docs/PHASE-2-BUILD-PLAN.md`)**: *why* each click triggers its own
separate render rather than all 157 collapsing into one. Confirmed via a real CPU profile (Chrome
DevTools Profiler, attached over CDP) taken during the actual 157-click burst against this exact
repo, not assumed: React does flush any pending passive effects synchronously at the start of
handling each new discrete event, specifically so a prior click's effects can't lag indefinitely
behind a rapid-fire burst — so 157 clicks dispatched in one tight synchronous loop still produce
157 separate render+commit+effect cycles, not one batched pass, even though nothing ever yields to
the browser between them (confirmed as one continuous ~22-27s "long task" via a
`PerformanceObserver({entryTypes:['longtask']})`).

The CPU profile's real finding, though, was less about the worker and more about *where* those 157
cycles actually spent their time: the majority was **React's development-mode overhead**
(`jsxDEV`, element construction, dev-only prop validation — none of which exist in a production
build), not this app's own code. Confirmed directly: building and serving a **production** bundle
of the identical app and re-running the identical 157-click burst against this identical repo
dropped the render-after-burst time from ~22-27s to **~4s** — a ~6x improvement with *zero* code
changes, purely from removing dev-mode instrumentation. All the render-time numbers on this page
were measured against the Vite dev server, consistent with every other number in this repo's
benchmark suite (see [the main README](README.md#methodology)) — worth reading with that in mind.

Within that remaining ~4s (production build), the single largest *named* contributor was
`buildVisibleGraph` (`frontend/src/graph/collapseDirectories.ts`) — confirmed via the same CPU
profile to be re-walking the entire `defines`-edge parent/child structure from scratch on every
one of the 157 calls, even though that structure never depends on `visibleIds` and is identical
across all of them. Fixed: `parentOf`/`childCountByParent` are now cached in a `WeakMap` keyed on
the `edges` array identity, computed once instead of once per click. This closed part of the gap
(~4.0s → ~3.4s in the production-build benchmark) but not most of it — the remaining, larger cost
was React re-rendering 157 separate times, which a per-function cache can't reduce.

**Fixed** (`frontend/src/App.tsx`): the `visibleIds` state feeding `buildVisibleGraph`/the canvas
is now debounced (`useDebouncedValue`, 150ms) before it reaches that expensive pipeline — a rapid
burst of clicks now pays for one `buildVisibleGraph`+layout pass instead of 157. Deliberately
split, not a blanket debounce: the checkbox's own visual checked state stays on the *un-debounced*
`visibleIds` directly, so a native checkbox never visibly lags a click; only the canvas rendering
waits. Re-benchmarked (production build): **~3.4s → ~2.49s**. A regression test
(`App.test.tsx`, "coalesces a rapid burst of checkbox clicks") locks in the coalescing property
itself, not just the eventual end state — worth calling out since an early version of that test
passed even with the fix reverted, because a sanity-check revert only touched the memo's
computation and missed its dependency array (the part that actually gates *when* it recomputes);
fixed before trusting the test.

**Not fully closed, and now understood why**: dev-mode's number barely moved (still ~20-25s
render-after-data) despite the same fix. `Tree.tsx`'s sidebar rows have no row-level memoization,
so the checkbox's own instant, deliberately-un-debounced `visibleIds` update still re-renders the
*entire* 157-row tree on every click — cheap in a production build (confirmed: React reconciliation
itself is fast), but still paying full dev-mode `jsxDEV` overhead per row per click, same root
cause as the original 22-27s finding above, just relocated from the canvas to the sidebar. Not
fixed here — would mean memoizing individual tree rows so only the toggled row itself re-renders.
