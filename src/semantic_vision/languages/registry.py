"""Lookup of a `LanguageAdapter` by string id. A new language plugs in by
constructing one `LanguageAdapter` and calling `register` here.
"""

from __future__ import annotations

from semantic_vision.languages.base import LanguageAdapter
from semantic_vision.languages.javascript import JAVASCRIPT_ADAPTER
from semantic_vision.languages.python import PYTHON_ADAPTER

_ADAPTERS: dict[str, LanguageAdapter] = {}


def register(adapter: LanguageAdapter) -> None:
    _ADAPTERS[adapter.language_id] = adapter


def get_adapter(language_id: str) -> LanguageAdapter:
    try:
        return _ADAPTERS[language_id]
    except KeyError:
        raise ValueError(f"Unknown language: {language_id!r}") from None


register(PYTHON_ADAPTER)
register(JAVASCRIPT_ADAPTER)
