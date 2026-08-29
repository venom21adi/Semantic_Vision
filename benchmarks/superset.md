# apache/superset (Python) — case study

[Apache Superset](https://github.com/apache/superset) — a widely used open-source BI/data-
visualization platform, chosen as a **code-to-data-lineage case study**: its backend is Flask +
SQLAlchemy, with declarative ORM models and a large Alembic migration history, so it's a real,
well-known codebase where Semantic Vision's Table/Column/`MAPS_TO`/`FOREIGN_KEY`/`READS`/`WRITES`
detection has genuine data to work with — unlike FastAPI (the main Python entry in the top-level
comparison), which has no ORM layer to speak of.

Benchmarked at commit `1c8d58a77bda36f892cc27298ed87ded43e6ef9f` (2026-08-29), scoped to `superset/`
(the Python backend) only — **not** the full monorepo. A full shallow clone of the repo checks out
fine at a short path, but `superset-frontend/` and `docs/` both contain files whose relative paths
exceed 140-155 characters (e.g. `docs/developer_docs_versioned_docs/version-6.1.0/api/get-metadata-
information-about-this-api-resource-rowlevelsecurity-info.RequestSchema.json`); combined with a
longer base path (the kind a real checkout location, e.g. deep under a user profile or temp
directory, would typically have), that exceeds Windows' 260-character `MAX_PATH` and the checkout
fails with `Filename too long` on those two directories specifically — confirmed directly: a
clone of this exact commit into a long base path failed on 60+ files across `docs/` and
`superset-frontend/`, while `superset/` (1,679 files) checked out completely intact in that same
failed clone. Scoped to `superset/` for that reason, the same deliberate, explicit-reason scoping
already applied to three.js (`src/`) and webpack (`lib/`) — see
[the main README](README.md#repo-selection-and-scope-notes). Not added as a second Python row in
the main comparison table (FastAPI already covers that slot); this is a special-purpose case study,
same treatment as webpack.

## Results

| Metric | Value |
|---|---|
| Files | 1,458 |
| Nodes | 11,258 |
| Edges | 74,444 |
| Parse errors | 0 |
| Backend parse — cold | 39.74s |
| Backend parse — warm | 9.35s |
| Complexity index build | 6.52–6.76s |
| `POST /api/parse-repo` | 10.17s |
| `GET /api/graph` | 0.18s |
| Graph payload | 14,563.5 KB |
| Browser: time to data | not measured (see Notes) |
| Browser: time to render | not measured (see Notes) |

### Lineage-specific breakdown

The actual point of this case study — how much of the graph is real code-to-data lineage, not just
code structure:

| Kind | Count |
|---|---|
| `TABLE` nodes | 37 |
| `COLUMN` nodes | 206 |
| `MAPS_TO` edges (ORM class → table) | 178 |
| `FOREIGN_KEY` edges (table → table) | 12 |
| `READS` edges (function → table) | 325 |
| `WRITES` edges (function → table) | 137 |
| **Reads + writes total** | **462** |

All of the above came from a direct, in-process parse of the same clone used for the timing runs
(`parse_repository("superset/", language="python")`, counted by `node.kind`/`edge.kind`, the same
pattern `scripts/benchmark_repo_load.py` itself uses) — not copied from an earlier, informal look
at this repo. 37 tables and 206 columns detected from Superset's declarative SQLAlchemy models and
Alembic migration history, with 178 `MAPS_TO` edges connecting ORM classes to the tables they
declare and 12 real foreign-key edges between tables. 462 `READS`/`WRITES` edges is a meaningful
slice of real, function-level data lineage extracted automatically from a 1,458-file production
codebase — out of 74,444 total edges, the lineage-specific edges (652: 178 + 12 + 325 + 137) are a
small fraction of the graph, exactly as expected (most edges in any repo are `CALLS`/`IMPORTS`/
`DEFINES`), but they're the fraction this case study exists to demonstrate.

## Notes

Zero parse errors on a real, unmodified third-party codebase, same as every other repo in this
benchmark set.

**Backend parse — cold vs. warm**: measured with the same two-invocation procedure as every other
repo in this folder (see [the main README](README.md#cold-vs-warm-backend-parse-added-after-the-original-publish)) —
a fresh shallow clone, parsed once immediately after cloning (**39.74s cold**), then parsed again
immediately on the identical files, same process (**9.35s warm**). A ~4.3x gap, on the low end of
the 5.7x–16x range seen across the main four repos, but the same universal first-read-off-disk
effect, not a superset-specific anomaly. File/node/edge/parse-error counts were identical between
the two runs, as expected — only timing changed.

**API round trip**: measured with a locally started backend (`uv run uvicorn
semantic_vision.api.app:app --port 8000`, stopped again immediately after this measurement) — port
8000 was free at the time. `POST /api/parse-repo` (10.17s) is close to the warm parse number
(9.35s) plus the complexity-index build, consistent with the other repos in this set.

**Browser tier intentionally not measured**: port 5173 (the only origin this project's backend CORS
policy whitelists, hardcoded in `src/semantic_vision/api/app.py`) was already occupied by another
active session's Vite dev server on this machine at benchmark time. Starting a second one would
either fail outright or risk interfering with that session's live work, so this tier was skipped
rather than guessed at. This is also consistent with the point of this case study: it exists to
demonstrate lineage-detection scale (the table above), not render performance, which the main
three-repo comparison already covers per language.

**Scope**: `superset/` only. 1,679 files exist on disk under `superset/`, of which exactly 1,458 are
`.py` files — matching the parser's reported file count exactly, confirming discovery correctly
picked up every Python source file and skipped the other 221 (translations, static assets, config
files, etc.), the same discovery behavior seen on every other repo in this set. See the scoping
explanation above and in [the main README](README.md#repo-selection-and-scope-notes) for why
`superset-frontend/` and `docs/` are excluded from this case study entirely.
