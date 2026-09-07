"""Shared helper for re-locating a Java method/constructor/type's exact
tree-sitter node from a resolved graph `Node`, re-parsing its owning file
on demand -- the Java analogue of `ts_locate.py`.

Simpler than `ts_locate.py`: Java has no field-bound or variable-
declarator-bound function/class values (every method lives in a
`method_declaration`/`constructor_declaration`, every type in
`java_extractor.py`'s `_TYPE_DECLARATION_TYPES`), so there's only one
def-shape to match instead of four. Imports `java_extractor.py`'s own
private helpers/type set directly, the same "single source of truth for
what counts as a def" precedent `ts_locate.py`'s own docstring already
justifies for JS.
"""

from __future__ import annotations

from pathlib import Path

import tree_sitter

from semantic_vision.models import Node
from semantic_vision.parser import java_extractor as jx
from semantic_vision.parser.java_extractor import _TYPE_DECLARATION_TYPES, _line, _text

TSNode = tree_sitter.Node

# Keyed by (line, name) -- matches `_match`'s own return shape and how
# `locate()` is called (by `Node.line_start`/`Node.label`).
DefIndex = dict[tuple[int, str], TSNode]

_DEF_TYPES = frozenset({"method_declaration", "constructor_declaration"}) | _TYPE_DECLARATION_TYPES


def get_tree(
    root: Path, file: str, trees: dict[str, tree_sitter.Tree | None]
) -> tree_sitter.Tree | None:
    """Parses `file` (relative to `root`) once, caching the result (or the
    fact that it failed to read) in `trees`. Unlike `ast_locate.get_tree`,
    there's no "failed to parse" case to cache -- tree-sitter never raises,
    it always returns a best-effort tree.
    """
    if file not in trees:
        try:
            source = (root / file).read_text(encoding="utf-8")
            trees[file] = jx.parse_tree(source, file)
        except OSError:
            trees[file] = None
    return trees[file]


def _match(node: TSNode) -> tuple[str, TSNode, int] | None:
    """If `node` is a method/constructor/class/interface/enum declaration,
    returns `(name, def_node, line)` -- `def_node`/`line` are the node
    itself, matching `RawFunction.lineno`/`RawClass.lineno`, which are
    always the declaration's own line."""
    if node.type in _DEF_TYPES:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        return _text(name_node), node, _line(node)
    return None


def _build_index(tree: tree_sitter.Tree) -> DefIndex:
    """One walk over the whole tree, building a (line, name) -> node
    lookup -- mirrors `ts_locate.py`'s own `_build_index` (see its
    docstring for why this replaces a per-`locate()`-call walk)."""
    index: DefIndex = {}

    def walk(node: TSNode) -> None:
        match = _match(node)
        if match is not None:
            name, def_node, line = match
            index.setdefault((line, name), def_node)
        for child in node.children:
            walk(child)

    walk(tree.root_node)
    return index


def get_index(
    root: Path,
    file: str,
    trees: dict[str, tree_sitter.Tree | None],
    indices: dict[str, DefIndex],
) -> DefIndex:
    """Builds and caches `file`'s index on first access; returns the same
    cached index on every later access."""
    if file not in indices:
        tree = get_tree(root, file, trees)
        indices[file] = _build_index(tree) if tree is not None else {}
    return indices[file]


def find_def_node(index: DefIndex, target_line: int, target_label: str) -> TSNode | None:
    return index.get((target_line, target_label))


def locate(
    root: Path,
    node: Node,
    trees: dict[str, tree_sitter.Tree | None],
    indices: dict[str, DefIndex],
) -> TSNode | None:
    index = get_index(root, node.file, trees, indices)
    return find_def_node(index, node.line_start, node.label)
