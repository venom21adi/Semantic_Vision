"""Lookup of a `LanguageAdapter` by string id. A new language plugs in by
constructing one `LanguageAdapter` and calling `register` here.
"""

from __future__ import annotations

from semantic_vision.languages.base import LanguageAdapter
from semantic_vision.languages.javascript import JAVASCRIPT_ADAPTER
from semantic_vision.languages.python import PYTHON_ADAPTER


class UnknownLanguageError(ValueError):
    """`language_id` isn't a registered `LanguageAdapter`. A `ValueError`
    subclass (not a bare `ValueError`) so a caller distinguishing "bad
    input" from an unrelated internal bug -- e.g. `api/routes.py` turning
    this into a 400 -- can catch it specifically, rather than risking a
    future, unrelated `ValueError` raised deeper in parsing/resolution
    being silently reported to the user as a bad request instead of
    surfacing as the bug it actually is."""


_ADAPTERS: dict[str, LanguageAdapter] = {}


def register(adapter: LanguageAdapter) -> None:
    _ADAPTERS[adapter.language_id] = adapter


def get_adapter(language_id: str) -> LanguageAdapter:
    try:
        return _ADAPTERS[language_id]
    except KeyError:
        raise UnknownLanguageError(f"Unknown language: {language_id!r}") from None


register(PYTHON_ADAPTER)
register(JAVASCRIPT_ADAPTER)
