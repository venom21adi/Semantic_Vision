"""Shared contract every language adapter implements, so `repo_parser.py`
can drive parsing/resolution without knowing which language it's for.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from semantic_vision.models import Edge
from semantic_vision.parser.extractor import RawModule
from semantic_vision.resolver.imports import ImportBinding, ImportResolution
from semantic_vision.resolver.symbol_table import ModuleIndex


class ParseSyntaxError(Exception):
    """Raised by a `LanguageAdapter.parse_file` when `source` is not
    syntactically valid for that language. Carries the same
    message/line shape `repo_parser.py` turns into a `ParseError`.
    """

    def __init__(self, message: str, line: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.line = line


@dataclass(frozen=True)
class LanguageAdapter:
    language_id: str
    file_extensions: frozenset[str]
    """e.g. `frozenset({".py"})`. Passed to `discover_files`."""
    parse_file: Callable[[str, str], RawModule]
    """`(source, rel_path) -> RawModule`. Raises `ParseSyntaxError` on
    invalid syntax instead of a language-native exception."""
    dotted_module_path: Callable[[str], str]
    """`(rel_path) -> dotted path`, e.g. Python's `__init__.py`
    collapsing rule. Injected into `build_symbol_table`."""
    resolve_imports: Callable[
        [str, RawModule, dict[str, str], dict[str, ModuleIndex]], ImportResolution
    ]
    resolve_calls: Callable[
        [
            str,
            RawModule,
            ModuleIndex,
            dict[str, ImportBinding],
            dict[str, ModuleIndex],
            dict[str, str],
        ],
        list[Edge],
    ]
    excluded_dirs: frozenset[str] = frozenset()
    """Directory names skipped during discovery in addition to the shared
    exclusions (e.g. Go's `vendor`)."""
    bind_root: Callable[[Path], LanguageAdapter] | None = None
    """Optional per-repository setup hook: given the repository root,
    returns the adapter to actually parse with (typically `self` with
    `resolve_imports`/`resolve_calls` closed over repo-level facts such as
    Go's `go.mod` module path). Called once per `parse_repository`."""
