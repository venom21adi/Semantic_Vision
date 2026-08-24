"""Shared helper for re-locating a function or class's exact AST node from
a resolved graph `Node`, re-parsing its owning file on demand.

Extracted here once a third call site needed it (`analysis/complexity.py`,
joining `ai/context.py` and `flowchart/cfg.py`, which had each carried an
identical private copy until now) -- the project's convention is to
extract a shared helper after two proven usages, not preemptively for a
single reuse.
"""

from __future__ import annotations

import ast
from pathlib import Path

from semantic_vision.models import Node

DefNode = ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef


def get_tree(root: Path, file: str, trees: dict[str, ast.Module | None]) -> ast.Module | None:
    """Parses `file` (relative to `root`) once, caching the result (or the
    fact that it failed) in `trees` so re-locating several nodes from the
    same file doesn't re-read and re-parse it each time.
    """
    if file not in trees:
        try:
            source = (root / file).read_text(encoding="utf-8")
            trees[file] = ast.parse(source, filename=file)
        except (OSError, SyntaxError):
            trees[file] = None
    return trees[file]


def find_def_node(tree: ast.Module, node: Node) -> DefNode | None:
    for candidate in ast.walk(tree):
        if not isinstance(candidate, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            continue
        if candidate.lineno == node.line_start and candidate.name == node.label:
            return candidate
    return None


def locate(root: Path, node: Node, trees: dict[str, ast.Module | None]) -> DefNode | None:
    tree = get_tree(root, node.file, trees)
    if tree is None:
        return None
    return find_def_node(tree, node)
