# three.js (JavaScript)

[three.js](https://github.com/mrdoob/three.js) — the most widely used WebGL/3D rendering library
in the JavaScript ecosystem, chosen as the primary JavaScript stress test for its scale and, just
as importantly, a genuinely nested directory structure — unlike webpack (see
[webpack.md](webpack.md)), which turned out to be a flat-structure edge case interesting enough to
publish on its own, but not representative of a typical repo's shape.

Benchmarked at commit `3744db754b77106a4b2921fcc0a77f0964b823a7` (2026-08-27), scoped to `src/`
(752 files) — three.js's real source, organized into 17 real subdirectories (`renderers/`,
`materials/`, `geometries/`, `math/`, `nodes/`, etc.) plus a handful of top-level files, only 24
items directly under `src/`. No test-fixture-bloat problem here — `test/`, `examples/`, and
`docs/` all live outside `src/` at the repo root and are naturally excluded by pointing at `src/`
directly.

## Results

| Metric | Value |
|---|---|
| Files | 752 |
| Nodes | 6,014 |
| Edges | 27,316 |
| Parse errors | 0 |
| Backend parse | 2.33s |
| Complexity index build | ~~17.69s~~ **2.93–3.01s, fixed — see below** |
| `POST /api/parse-repo` | 3.12s |
| `GET /api/graph` | 0.09s |
| Graph payload | 5,349.5 KB |
| Browser: time to data | 3.21–3.50s |
| Browser: time to render | 4.88–5.01s |

## Notes

Clean numbers across the board, comparable in shape to FastAPI's — this is the JS baseline the
3-way comparison in [the main README](README.md) uses. The complexity-index build was originally
17.69s — meaningfully above FastAPI's 3.41s or nest's 7.51s at the time, despite fewer nodes than
either — from the same root cause documented in detail in
[webpack.md](webpack.md#complexity-index-build--was-12813s-now-543583s-fixed):
`ts_locate.find_def_node` re-walked an entire file's syntax tree per function lookup, so files
with many functions cost more regardless of repo. three.js's largest files
(`renderers/common/Renderer.js`, ~4,000 lines) are far smaller than webpack's worst case (~13,500
lines), so the effect here was real but far less severe — good supporting evidence at the time
that this was a general, file-size-driven cost, not a webpack-only quirk.

**Fixed** (branch `perf/js-ts-def-lookup`, same fix as webpack's): re-benchmarked on the same
repo/commit after `ts_locate.py`/`ast_locate.py` switched to a build-once-per-file index —
**2.93s and 3.01s** across two runs, a ~6x improvement.
