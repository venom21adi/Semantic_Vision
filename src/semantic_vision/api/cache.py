"""In-memory cache of parsed repositories, keyed by resolved directory
path, so repeat requests for the same repo don't re-walk and re-parse it.
"""

from __future__ import annotations

import threading
from pathlib import Path

from semantic_vision.analysis.complexity import ComplexityScore, build_complexity_index
from semantic_vision.analysis.coverage import CoverageRiskScore, build_coverage_risk_scores
from semantic_vision.analysis.duplicates import DuplicateGroup, build_duplicate_groups
from semantic_vision.analysis.git_ops import compute_file_churn
from semantic_vision.analysis.impact import build_reverse_caller_index
from semantic_vision.models import EdgeKind, ParseResult


class RepoCache:
    def __init__(self) -> None:
        self._results: dict[str, ParseResult] = {}
        self._reverse_indexes: dict[str, dict[str, list[tuple[str, EdgeKind]]]] = {}
        self._complexity_indexes: dict[str, dict[str, ComplexityScore]] = {}
        # The complexity index that existed right before the most recent
        # `set()` promoted it out of `_complexity_indexes` (see `set()`) --
        # the baseline `GET /api/complexity/diff` compares a fresh reparse
        # against, so a caller can see whether an edit made functions more
        # or less complex since the last time this path's complexity was
        # actually looked at.
        self._previous_complexity_indexes: dict[str, dict[str, ComplexityScore]] = {}
        self._doc_roots: dict[str, Path] = {}
        # Guards building a repo's complexity index: `set()` no longer
        # builds it eagerly (see below), so concurrent `/api/complexity`
        # requests for the same just-parsed repo (e.g. two panels, two
        # tabs) could otherwise both miss the cache and both pay the
        # AST-walk cost.
        self._complexity_lock = threading.Lock()
        # Per-(git root, window) churn counts for the hotspots tab, keyed by
        # `"{_key(git_root)}::{window_days}"`. Deliberately its own dict and
        # lock, not folded into `_complexity_indexes`: churn is keyed by git
        # root rather than the parsed path (they can differ -- a subdirectory
        # parse still shares one git root's history), and its invalidation
        # is different too -- a reparse (`set()`) doesn't change git history,
        # so `set()` never touches this cache. There's no TTL: like
        # `_complexity_indexes`, an entry lives for the process's lifetime
        # (or until `clear()`) once computed. A new commit landing inside an
        # already-cached window won't be reflected until then -- an accepted
        # tradeoff (an explicit, occasional "load hotspots" action, not a
        # hot path) rather than new invalidation machinery.
        self._churn_indexes: dict[str, dict[str, int]] = {}
        self._churn_lock = threading.Lock()
        # Per-file, per-line hit counts from the most recently ingested
        # coverage report for this path (see `POST /api/coverage/ingest`).
        # Unlike churn, this *is* invalidated on reparse (see `set()`):
        # it's cross-referenced against a function's own `line_start`/
        # `line_end`, which can shift on a reparse, so a stale ingest
        # would silently misattribute coverage to the wrong lines.
        self._coverage_line_hits: dict[str, dict[str, dict[int, int]]] = {}
        # The risk ranking computed from `_coverage_line_hits` plus the
        # complexity index and reverse caller index -- lazily built and
        # cached under the same lock as the raw ingest, since building it
        # calls `find_upstream_callers` once per function (an O(BFS) cost
        # per node, the same traversal `GET /api/impact` pays once per
        # request but this would otherwise pay once per function per
        # request). Invalidated by both a fresh ingest (see
        # `set_coverage_line_hits`) and a reparse (see `set()`) -- either
        # can change the numbers this ranking is built from.
        self._coverage_risk_scores: dict[str, list[CoverageRiskScore]] = {}
        self._coverage_lock = threading.Lock()
        # Lazily built, double-checked-locking, invalidated on reparse --
        # same treatment as `_complexity_indexes`, since this is another
        # AST walk over the same parsed source.
        self._duplicate_indexes: dict[str, list[DuplicateGroup]] = {}
        self._duplicate_lock = threading.Lock()

    @staticmethod
    def _key(path: str) -> str:
        return Path(path).resolve().as_posix()

    def get(self, path: str) -> ParseResult | None:
        return self._results.get(self._key(path))

    def get_reverse_caller_index(self, path: str) -> dict[str, list[tuple[str, EdgeKind]]] | None:
        return self._reverse_indexes.get(self._key(path))

    def get_or_build_complexity_index(self, path: str) -> dict[str, ComplexityScore]:
        key = self._key(path)
        existing = self._complexity_indexes.get(key)
        if existing is not None:
            return existing
        with self._complexity_lock:
            existing = self._complexity_indexes.get(key)
            if existing is not None:
                return existing
            index = build_complexity_index(self._results[key])
            self._complexity_indexes[key] = index
            return index

    def get_current_and_previous_complexity_index(
        self, path: str
    ) -> tuple[dict[str, ComplexityScore], dict[str, ComplexityScore] | None]:
        """The pair `GET /api/complexity/diff` needs: the current index
        (building it if nothing's cached yet) and whatever baseline was
        promoted out of `_complexity_indexes` by the most recent `set()`
        (`None` if this path's complexity has never been computed and then
        reparsed -- see `_previous_complexity_indexes`'s own docstring).

        Deliberately one method under one lock acquisition, not two separate
        calls (`get_or_build_complexity_index` then a `previous` lookup): a
        `set()` landing in the gap between two separate calls could promote
        the `current` this request just built into `_previous_complexity_indexes`,
        making `current` and `previous` equal and silently reporting zero
        changes on a real edit. Always takes the lock, unlike
        `get_or_build_complexity_index`'s lock-free fast path for the
        already-built case -- correctness here matters more than avoiding
        lock contention on what's already a much rarer, heavier call
        (triggered by an explicit compare action, always right after a
        reparse) than a plain `GET /api/complexity`.
        """
        key = self._key(path)
        with self._complexity_lock:
            current = self._complexity_indexes.get(key)
            if current is None:
                current = build_complexity_index(self._results[key])
                self._complexity_indexes[key] = current
            return current, self._previous_complexity_indexes.get(key)

    def set(self, path: str, result: ParseResult) -> None:
        key = self._key(path)
        self._results[key] = result
        # Built once here, at parse time, rather than per impact query.
        self._reverse_indexes[key] = build_reverse_caller_index(result.edges)
        # Complexity index is built lazily instead (see
        # `get_or_build_complexity_index`) -- it costs nearly as much as
        # parsing itself, so paying it on every parse-repo call regardless
        # of whether the complexity report is ever opened is wasted work.
        # Drop any index from a previous parse of this path so a stale one
        # is never served after a reparse -- but promote it into
        # `_previous_complexity_indexes` first, as the baseline a later
        # `GET /api/complexity/diff` call compares a fresh reparse against.
        # Only promotes when an index actually existed (i.e. was built via a
        # prior `GET /api/complexity`); if nothing had been viewed since the
        # last promotion, today's existing baseline is left alone rather
        # than cleared, so "the last time this path's complexity was
        # actually looked at" survives a reparse that happened in between
        # without anyone checking complexity in the meantime.
        #
        # Guarded by the same lock as the build itself: Starlette runs sync
        # route handlers in a thread pool, so a reparse can genuinely race a
        # concurrent lazy build for the same path. Without sharing the lock,
        # a build already holding it could read the *old* `self._results[key]`
        # before this method's unguarded assignment above is visible to it,
        # finish after this pop has already run, and re-populate
        # `_complexity_indexes[key]` with an index computed from the stale
        # result -- resurrecting exactly the staleness this pop exists to
        # prevent. Sharing the lock forces the two operations to fully
        # precede or follow each other, so a build that starts after this
        # point is guaranteed to see the new result, and a build already in
        # flight has its result correctly popped once it finishes.
        with self._complexity_lock:
            previous = self._complexity_indexes.pop(key, None)
            if previous is not None:
                self._previous_complexity_indexes[key] = previous
        with self._coverage_lock:
            self._coverage_line_hits.pop(key, None)
            self._coverage_risk_scores.pop(key, None)
        with self._duplicate_lock:
            self._duplicate_indexes.pop(key, None)

    def set_coverage_line_hits(
        self, path: str, line_hits_by_file: dict[str, dict[int, int]]
    ) -> None:
        with self._coverage_lock:
            key = self._key(path)
            self._coverage_line_hits[key] = line_hits_by_file
            # A fresh ingest invalidates any risk ranking built from the
            # previous one -- otherwise a re-ingest (a corrected coverage
            # report, say) would silently keep serving stale scores.
            self._coverage_risk_scores.pop(key, None)

    def get_coverage_line_hits(self, path: str) -> dict[str, dict[int, int]] | None:
        return self._coverage_line_hits.get(self._key(path))

    def get_or_build_coverage_risk_scores(
        self,
        path: str,
        line_hits_by_file: dict[str, dict[int, int]],
    ) -> list[CoverageRiskScore]:
        key = self._key(path)
        existing = self._coverage_risk_scores.get(key)
        if existing is not None:
            return existing
        with self._coverage_lock:
            existing = self._coverage_risk_scores.get(key)
            if existing is not None:
                return existing
            scores = build_coverage_risk_scores(
                self._results[key].nodes,
                self.get_or_build_complexity_index(path),
                self._reverse_indexes[key],
                line_hits_by_file,
            )
            self._coverage_risk_scores[key] = scores
            return scores

    def get_or_build_duplicate_groups(self, path: str) -> list[DuplicateGroup]:
        key = self._key(path)
        existing = self._duplicate_indexes.get(key)
        if existing is not None:
            return existing
        with self._duplicate_lock:
            existing = self._duplicate_indexes.get(key)
            if existing is not None:
                return existing
            groups = build_duplicate_groups(self._results[key])
            self._duplicate_indexes[key] = groups
            return groups

    def get_or_compute_churn(self, git_root: Path, window_days: int) -> dict[str, int]:
        key = f"{self._key(str(git_root))}::{window_days}"
        existing = self._churn_indexes.get(key)
        if existing is not None:
            return existing
        with self._churn_lock:
            existing = self._churn_indexes.get(key)
            if existing is not None:
                return existing
            churn = compute_file_churn(git_root, window_days=window_days)
            self._churn_indexes[key] = churn
            return churn

    def get_doc_root(self, path: str) -> Path | None:
        return self._doc_roots.get(self._key(path))

    def set_doc_root(self, path: str, doc_root: Path) -> None:
        # Kept independent of `set()` so the save location can be changed
        # (via `PUT /api/doc-root`) without forcing a re-parse -- the
        # whole point of letting it be scoped separately from what's
        # parsed in the first place.
        self._doc_roots[self._key(path)] = doc_root

    def clear(self) -> None:
        self._results.clear()
        self._reverse_indexes.clear()
        self._complexity_indexes.clear()
        self._previous_complexity_indexes.clear()
        self._doc_roots.clear()
        self._churn_indexes.clear()
        self._coverage_line_hits.clear()
        self._coverage_risk_scores.clear()
        self._duplicate_indexes.clear()


cache = RepoCache()
