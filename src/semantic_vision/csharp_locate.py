"""Re-locates a C# method/constructor/accessor/type's exact tree-sitter node
from a resolved graph `Node`, re-parsing its owning file on demand -- the C#
analogue of `java_locate.py`.

C# adds three wrinkles over Java, all consequences of how
`parser/csharp_extractor.py` names graph nodes:

- A property or indexer with logic becomes one node per accessor, named after
  the property and positioned on the *accessor* (`get`/`set`/`init`), or on the
  property itself when it is expression-bodied (`int X => ...`).
- Operators are labelled `operator +` / `operator implicit` rather than by a
  name field.
- Same-named sibling types that differ in generic arity are renamed CLR-style
  (`Table`2`); the arity suffix is stripped before lookup, the line disambiguates.

The file is parsed with the same `parse_tree` the extractor used (conditional
compilation resolved, grammar workarounds applied), so line numbers match the
graph's.
"""

from __future__ import annotations

from pathlib import Path

import tree_sitter

from semantic_vision.models import Node
from semantic_vision.parser import csharp_extractor as cx
from semantic_vision.parser.csharp_extractor import TYPE_DECLARATION_TYPES, _line, _text

TSNode = tree_sitter.Node

DefIndex = dict[tuple[int, str], TSNode]

_FUNCTION_TYPES = frozenset({"method_declaration", "constructor_declaration"})
_OPERATOR_TYPES = frozenset({"operator_declaration", "conversion_operator_declaration"})
_PROPERTY_TYPES = frozenset({"property_declaration", "indexer_declaration"})


def get_tree(
    root: Path, file: str, trees: dict[str, tree_sitter.Tree | None]
) -> tree_sitter.Tree | None:
    """Parses `file` (relative to `root`) once, caching the result -- or the
    fact it could not be read -- in `trees`."""
    if file not in trees:
        try:
            source = (root / file).read_text(encoding="utf-8", errors="replace")
            trees[file] = cx.parse_tree(source)
        except OSError:
            trees[file] = None
    return trees[file]


def _property_name(node: TSNode) -> str:
    if node.type == "indexer_declaration":
        return "this[]"
    return _text(node.child_by_field_name("name"))


def _match(node: TSNode) -> tuple[str, TSNode, int] | None:
    """`(label, def_node, line)` for every node the extractor turns into a graph node."""
    t = node.type
    if t in _FUNCTION_TYPES or t in TYPE_DECLARATION_TYPES:
        name = _text(node.child_by_field_name("name"))
        return (name, node, _line(node)) if name else None
    if t in _OPERATOR_TYPES:
        return cx.operator_label(node), node, _line(node)
    if t == "accessor_declaration":
        # The extractor positions an accessor node on the accessor itself.
        parent = node.parent.parent if node.parent is not None else None
        if parent is not None and parent.type in _PROPERTY_TYPES:
            return _property_name(parent), node, _line(node)
        return None
    if t in _PROPERTY_TYPES and any(c.type == "arrow_expression_clause" for c in node.children):
        # Expression-bodied property/indexer: one getter node on the property's own line.
        return _property_name(node), node, _line(node)
    return None


_DEF_QUERY = tree_sitter.Query(
    cx.CSHARP,
    "[\n"
    + "\n".join(
        f"  ({t})"
        for t in sorted(
            _FUNCTION_TYPES
            | _OPERATOR_TYPES
            | _PROPERTY_TYPES
            | TYPE_DECLARATION_TYPES
            | {"accessor_declaration"}
        )
        if cx.CSHARP.id_for_node_kind(t, True)  # a type this grammar version defines
    )
    + "\n] @def",
)


def _build_index(tree: tree_sitter.Tree) -> DefIndex:
    """A (line, label) -> node lookup. A tree-sitter query finds the handful of
    definition nodes natively; visiting every node from Python made this the dominant
    cost of building the complexity index on large repositories."""
    index: DefIndex = {}
    captured = tree_sitter.QueryCursor(_DEF_QUERY).captures(tree.root_node).get("def", ())
    for node in sorted(captured, key=lambda n: n.start_byte):
        match = _match(node)
        if match is not None:
            label, def_node, line = match
            index.setdefault((line, label), def_node)
    return index


def get_index(
    root: Path,
    file: str,
    trees: dict[str, tree_sitter.Tree | None],
    indices: dict[str, DefIndex],
) -> DefIndex:
    """Builds and caches `file`'s index on first access."""
    if file not in indices:
        tree = get_tree(root, file, trees)
        indices[file] = _build_index(tree) if tree is not None else {}
    return indices[file]


def find_def_node(index: DefIndex, target_line: int, target_label: str) -> TSNode | None:
    return index.get((target_line, target_label.split("`")[0]))


def locate(
    root: Path,
    node: Node,
    trees: dict[str, tree_sitter.Tree | None],
    indices: dict[str, DefIndex],
) -> TSNode | None:
    index = get_index(root, node.file, trees, indices)
    return find_def_node(index, node.line_start, node.label)
