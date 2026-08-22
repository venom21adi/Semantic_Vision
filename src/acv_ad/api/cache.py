"""In-memory cache of parsed repositories, keyed by resolved directory
path, so repeat requests for the same repo don't re-walk and re-parse it.
"""

from __future__ import annotations

from pathlib import Path

from acv_ad.models import ParseResult


class RepoCache:
    def __init__(self) -> None:
        self._results: dict[str, ParseResult] = {}

    @staticmethod
    def _key(path: str) -> str:
        return Path(path).resolve().as_posix()

    def get(self, path: str) -> ParseResult | None:
        return self._results.get(self._key(path))

    def set(self, path: str, result: ParseResult) -> None:
        self._results[self._key(path)] = result

    def clear(self) -> None:
        self._results.clear()


cache = RepoCache()
