"""Re-locates a Go function/method/type's exact tree-sitter node from a
resolved graph `Node`, re-parsing its owning file on demand -- the Go
analogue of `java_locate.py`.

Go has exactly three def shapes -- `function_declaration`,
`method_declaration`, and `type_spec`/`type_alias` -- and the graph `Node`'s
`(line_start, label)` pair identifies each one, with two wrinkles:

- A methods-only `RawClass` (see `go_extractor.py`) has no declaration of
  its own in the file, so a class `Node` for it never matches anything --
  correct, since there is no def node to point at.
- Repeated `init` functions carry labels `init`, `init#2`, ... (see
  `go_extractor.extract_module`); the `#n` suffix is stripped before
  lookup, and the line number alone disambiguates them.
"""

from __future__ import annotations

from pathlib import Path

import tree_sitter

from semantic_vision.models import Node
from semantic_vision.parser import go_extractor as gx
from semantic_vision.parser.go_extractor import _line, _text

TSNode = tree_sitter.Node

DefIndex = dict[tuple[int, str], TSNode]

_FUNCTION_TYPES = frozenset({"function_declaration", "method_declaration"})
_TYPE_TYPES = frozenset({"type_spec", "type_alias"})


def get_tree(
    root: Path, file: str, trees: dict[str, tree_sitter.Tree | None]
) -> tree_sitter.Tree | None:
    """Parses `file` (relative to `root`) once, caching the result -- or the
    fact it couldn't be read -- in `trees`."""
    if file not in trees:
        try:
            source = (root / file).read_text(encoding="utf-8")
            trees[file] = gx.parse_tree(source, file)
        except OSError:
            trees[file] = None
    return trees[file]


def _match(node: TSNode) -> tuple[str, TSNode, int] | None:
    if node.type in _FUNCTION_TYPES or node.type in _TYPE_TYPES:
        name_node = node.child_by_field_name("name")
        name = _text(name_node)
        if not name:
            return None
        return name, node, _line(node)
    return None


def _build_index(tree: tree_sitter.Tree) -> DefIndex:
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
    if file not in indices:
        tree = get_tree(root, file, trees)
        indices[file] = _build_index(tree) if tree is not None else {}
    return indices[file]


def find_def_node(index: DefIndex, target_line: int, target_label: str) -> TSNode | None:
    return index.get((target_line, target_label.partition("#")[0]))


def locate(
    root: Path,
    node: Node,
    trees: dict[str, tree_sitter.Tree | None],
    indices: dict[str, DefIndex],
) -> TSNode | None:
    index = get_index(root, node.file, trees, indices)
    return find_def_node(index, node.line_start, node.label)
