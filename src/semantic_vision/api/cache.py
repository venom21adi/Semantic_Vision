"""In-memory cache of parsed repositories, keyed by resolved directory
path, so repeat requests for the same repo don't re-walk and re-parse it.
"""

from __future__ import annotations

from pathlib import Path

from semantic_vision.analysis.impact import build_reverse_caller_index
from semantic_vision.models import ParseResult


class RepoCache:
    def __init__(self) -> None:
        self._results: dict[str, ParseResult] = {}
        self._reverse_indexes: dict[str, dict[str, list[str]]] = {}

    @staticmethod
    def _key(path: str) -> str:
        return Path(path).resolve().as_posix()

    def get(self, path: str) -> ParseResult | None:
        return self._results.get(self._key(path))

    def get_reverse_caller_index(self, path: str) -> dict[str, list[str]] | None:
        return self._reverse_indexes.get(self._key(path))

    def set(self, path: str, result: ParseResult) -> None:
        key = self._key(path)
        self._results[key] = result
        # Built once here, at parse time, rather than per impact query.
        self._reverse_indexes[key] = build_reverse_caller_index(result.edges)

    def clear(self) -> None:
        self._results.clear()
        self._reverse_indexes.clear()


cache = RepoCache()
