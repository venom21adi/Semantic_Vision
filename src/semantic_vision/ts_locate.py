"""Shared helper for re-locating a JS/TS function or class's exact
tree-sitter node from a resolved graph `Node`, re-parsing its owning
file on demand -- the tree-sitter analogue of `ast_locate.py`.

Deliberately imports `parser/javascript_extractor.py`'s own type sets
and helpers (`_FUNCTION_DECLARATION_TYPES`, `_CLASS_DECLARATION_TYPES`,
`_FUNCTION_VALUE_TYPES`, `_FIELD_DEFINITION_TYPES`, `_member_name`,
`_line`, `_text`) rather than re-deriving them, even though they're
private to that module -- a single source of truth for "what counts as
a def" so this module can't silently drift out of sync with what the
extractor actually captures as a graph node in the first place. If it
did, a whole class of JS/TS functions would silently fall back to a
placeholder instead of getting a real signature/complexity score.
"""

from __future__ import annotations

from pathlib import Path

import tree_sitter

from semantic_vision.models import Node
from semantic_vision.parser import javascript_extractor as jsx
from semantic_vision.parser.javascript_extractor import (
    _CLASS_DECLARATION_TYPES,
    _FIELD_DEFINITION_TYPES,
    _FUNCTION_DECLARATION_TYPES,
    _FUNCTION_VALUE_TYPES,
    _line,
    _member_name,
    _text,
)

TSNode = tree_sitter.Node


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
            trees[file] = jsx.parse_tree(source, file)
        except OSError:
            trees[file] = None
    return trees[file]


def _match(node: TSNode) -> tuple[str, TSNode, int] | None:
    """If `node` is itself one of the four def-shapes the extractor
    recognizes, returns `(name, def_node, line)` -- `def_node`/`line` are
    the *value* node (not the containing field/declarator statement) for
    the field-bound and declarator-bound cases, matching
    `RawFunction.lineno`, which is always the value's own line.
    """
    if node.type in _FUNCTION_DECLARATION_TYPES or node.type in _CLASS_DECLARATION_TYPES:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return None
        return _text(name_node), node, _line(node)

    if node.type == "method_definition":
        name_node = _member_name(node)
        if name_node is None:
            return None
        return _text(name_node), node, _line(node)

    if node.type in _FIELD_DEFINITION_TYPES:
        name_node = _member_name(node)
        value = node.child_by_field_name("value")
        is_def_value = value is not None and value.type in (*_FUNCTION_VALUE_TYPES, "class")
        if name_node is None or not is_def_value:
            return None
        return _text(name_node), value, _line(value)

    if node.type == "variable_declarator":
        name_node = node.child_by_field_name("name")
        value = node.child_by_field_name("value")
        if name_node is None or name_node.type != "identifier" or value is None:
            return None
        if value.type not in (*_FUNCTION_VALUE_TYPES, "class"):
            return None
        return _text(name_node), value, _line(value)

    return None


def find_def_node(tree: tree_sitter.Tree, target_line: int, target_label: str) -> TSNode | None:
    """Full-tree recursive search -- unconditional, no scope-transparency
    logic needed here (unlike the extractor's own walk), since a nested
    def's location doesn't depend on how it was reached.
    """

    def walk(node: TSNode) -> TSNode | None:
        match = _match(node)
        if match is not None:
            name, def_node, line = match
            if name == target_label and line == target_line:
                return def_node
        for child in node.children:
            found = walk(child)
            if found is not None:
                return found
        return None

    return walk(tree.root_node)


def locate(root: Path, node: Node, trees: dict[str, tree_sitter.Tree | None]) -> TSNode | None:
    tree = get_tree(root, node.file, trees)
    if tree is None:
        return None
    return find_def_node(tree, node.line_start, node.label)
