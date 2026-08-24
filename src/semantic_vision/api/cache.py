"""In-memory cache of parsed repositories, keyed by resolved directory
path, so repeat requests for the same repo don't re-walk and re-parse it.
"""

from __future__ import annotations

from pathlib import Path

from semantic_vision.analysis.complexity import ComplexityScore, build_complexity_index
from semantic_vision.analysis.impact import build_reverse_caller_index
from semantic_vision.models import ParseResult


class RepoCache:
    def __init__(self) -> None:
        self._results: dict[str, ParseResult] = {}
        self._reverse_indexes: dict[str, dict[str, list[str]]] = {}
        self._complexity_indexes: dict[str, dict[str, ComplexityScore]] = {}
        self._doc_roots: dict[str, Path] = {}

    @staticmethod
    def _key(path: str) -> str:
        return Path(path).resolve().as_posix()

    def get(self, path: str) -> ParseResult | None:
        return self._results.get(self._key(path))

    def get_reverse_caller_index(self, path: str) -> dict[str, list[str]] | None:
        return self._reverse_indexes.get(self._key(path))

    def get_complexity_index(self, path: str) -> dict[str, ComplexityScore] | None:
        return self._complexity_indexes.get(self._key(path))

    def set(self, path: str, result: ParseResult) -> None:
        key = self._key(path)
        self._results[key] = result
        # Built once here, at parse time, rather than per impact/complexity
        # query.
        self._reverse_indexes[key] = build_reverse_caller_index(result.edges)
        self._complexity_indexes[key] = build_complexity_index(result)

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
        self._doc_roots.clear()


cache = RepoCache()
