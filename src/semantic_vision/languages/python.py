"""The Python `LanguageAdapter` -- glues together the existing
parser/extractor + resolver modules, which remain plain, language-scoped
functions.
"""

from __future__ import annotations

import ast

from semantic_vision.languages.base import LanguageAdapter, ParseSyntaxError
from semantic_vision.parser.extractor import RawModule, extract_module
from semantic_vision.resolver.calls import resolve_calls
from semantic_vision.resolver.imports import resolve_imports

FILE_EXTENSIONS = frozenset({".py"})


def dotted_module_path(rel_path: str) -> str:
    """Python's `__init__.py`-collapsing packaging convention -- relocated
    verbatim from `resolver/symbol_table.py`'s former `_dotted_module_path`.
    """
    parts = rel_path.split("/")
    if parts[-1] == "__init__.py":
        return ".".join(parts[:-1])
    parts[-1] = parts[-1].removesuffix(".py")
    return ".".join(parts)


def parse_file(source: str, rel_path: str) -> RawModule:
    try:
        tree = ast.parse(source, filename=rel_path)
    except SyntaxError as exc:
        raise ParseSyntaxError(message=str(exc), line=exc.lineno) from exc
    return extract_module(tree, rel_path)


PYTHON_ADAPTER = LanguageAdapter(
    language_id="python",
    file_extensions=FILE_EXTENSIONS,
    parse_file=parse_file,
    dotted_module_path=dotted_module_path,
    resolve_imports=resolve_imports,
    resolve_calls=resolve_calls,
)
