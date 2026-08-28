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

# Keyed by (lineno, name) -- matches how `find_def_node` distinguishes
# candidates, and also how `locate()` is called (by `Node.line_start`/
# `Node.label`). Two entries can share a name (e.g. a nested class with a
# same-named sibling elsewhere in the file) but never share a full key
# within one file.
DefIndex = dict[tuple[int, str], DefNode]


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


def _build_index(tree: ast.Module) -> DefIndex:
    """One walk over the whole tree, building a (lineno, name) -> node
    lookup -- replaces re-walking the tree from scratch for every single
    `locate()` call on the same file, which is what made complexity-index
    building on a large, function-dense file (see `ts_locate._build_index`'s
    docstring for the confirmed-live numbers on the JS/TS side) cost
    O(functions in file x tree size) instead of O(tree size) once.
    `setdefault` preserves `ast.walk`'s traversal order as the tie-break for
    a (rare, currently unreachable in practice) duplicate key, matching the
    old linear scan's first-match-wins behavior exactly.
    """
    index: DefIndex = {}
    for candidate in ast.walk(tree):
        if not isinstance(candidate, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            continue
        index.setdefault((candidate.lineno, candidate.name), candidate)
    return index


def get_index(
    root: Path, file: str, trees: dict[str, ast.Module | None], indices: dict[str, DefIndex]
) -> DefIndex:
    """Builds and caches `file`'s index on first access; returns the same
    cached index on every later access, mirroring `get_tree`'s own
    build-once-reuse pattern for the underlying `ast.Module`.
    """
    if file not in indices:
        tree = get_tree(root, file, trees)
        indices[file] = _build_index(tree) if tree is not None else {}
    return indices[file]


def find_def_node(index: DefIndex, node: Node) -> DefNode | None:
    return index.get((node.line_start, node.label))


def locate(
    root: Path,
    node: Node,
    trees: dict[str, ast.Module | None],
    indices: dict[str, DefIndex],
) -> DefNode | None:
    index = get_index(root, node.file, trees, indices)
    return find_def_node(index, node)
