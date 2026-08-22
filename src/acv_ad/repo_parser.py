"""Top-level orchestration: discover, parse, and resolve a repository into
a deterministic `ParseResult`.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path

from acv_ad.models import ParseError, ParseResult
from acv_ad.parser.discovery import discover_python_files
from acv_ad.parser.extractor import RawModule, extract_module
from acv_ad.resolver.calls import resolve_calls
from acv_ad.resolver.imports import resolve_imports
from acv_ad.resolver.symbol_table import build_symbol_table


def parse_repository(root: str | Path) -> ParseResult:
    root_path = Path(root)
    if not root_path.is_dir():
        raise NotADirectoryError(f"Not a directory: {root_path}")
    if not os.access(root_path, os.R_OK):
        raise PermissionError(f"Directory is not readable: {root_path}")
    root_path = root_path.resolve()

    files = discover_python_files(root_path)
    all_rel_paths = [f.relative_to(root_path).as_posix() for f in files]

    raw_modules: dict[str, RawModule] = {}
    line_counts: dict[str, int] = {}
    parse_errors: list[ParseError] = []

    for path, rel_path in zip(files, all_rel_paths, strict=True):
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            parse_errors.append(ParseError(file=rel_path, message=str(exc)))
            continue

        line_counts[rel_path] = source.count("\n") + (0 if source.endswith("\n") else 1)

        try:
            tree = ast.parse(source, filename=rel_path)
        except SyntaxError as exc:
            parse_errors.append(ParseError(file=rel_path, line=exc.lineno, message=str(exc)))
            continue

        raw_modules[rel_path] = extract_module(tree, rel_path)

    symbol_table = build_symbol_table(all_rel_paths, raw_modules, line_counts)

    all_edges = list(symbol_table.defines_edges)
    for rel_path, raw in raw_modules.items():
        module_index = symbol_table.modules[rel_path]
        resolution = resolve_imports(
            rel_path, raw, symbol_table.module_by_dotted, symbol_table.modules
        )
        all_edges.extend(resolution.edges)
        all_edges.extend(
            resolve_calls(
                rel_path,
                raw,
                module_index,
                resolution.bindings,
                symbol_table.modules,
                symbol_table.module_by_dotted,
            )
        )

    nodes = sorted(symbol_table.nodes, key=lambda n: n.id)
    edges = sorted(all_edges, key=lambda e: (e.source, e.target, e.kind))
    variables = sorted(symbol_table.variables, key=lambda v: v.id)
    parse_errors.sort(key=lambda e: (e.file, e.line or 0))

    return ParseResult(
        root=root_path.as_posix(),
        nodes=nodes,
        edges=edges,
        variables=variables,
        parse_errors=parse_errors,
    )
