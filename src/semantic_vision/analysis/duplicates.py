"""Near-duplicate function detection (see docs/ideas/REPO-INTELLIGENCE-IDEAS.md's
Idea 2 -- exact-shape hashing only, confirmed scope: no near-miss/similarity-
threshold matching): normalizes each function's AST down to its bare shape --
node types only, with every identifier name, literal value, and comment
stripped away -- so a function that's byte-identical *after* renaming
variables and tweaking literals still hashes the same as its original.
Functions sharing a shape hash are grouped as duplicate candidates.

Reuses the same per-language `locate()` dispatch `analysis/complexity.py`
already established (`ast_locate`/`ts_locate`/`java_locate`) rather than
introducing a new one -- this is a new AST *walk* (a different purpose:
shape normalization, not a complexity count), not a new locate mechanism.
"""

from __future__ import annotations

import ast
import hashlib
from pathlib import Path

import tree_sitter
from pydantic import BaseModel

from semantic_vision import ast_locate, java_locate, ts_locate
from semantic_vision.ast_locate import locate
from semantic_vision.models import NodeKind, ParseResult
from semantic_vision.parser import java_extractor, javascript_extractor

_JS_EXTENSIONS = frozenset(javascript_extractor.GRAMMAR_BY_EXTENSION)
_JAVA_EXTENSIONS = frozenset(java_extractor.FILE_EXTENSIONS)


def _is_js_file(file: str) -> bool:
    return file.endswith(tuple(_JS_EXTENSIONS))


def _is_java_file(file: str) -> bool:
    return file.endswith(tuple(_JAVA_EXTENSIONS))


# A shape tree's total node count (see `_shape_size`) below this is skipped
# entirely -- a bare `def __init__(self): pass`-shaped function (shape size
# ~4) is common and hashes identically to hundreds of unrelated others,
# producing a "duplicate" group that's really just noise, not a real
# maintenance-cost finding. Empirically verified against real parses in all
# three languages (see this module's own tests): Python's `ast` never
# yields punctuation/keyword nodes, so a real single-`return`-expression
# function already sits at ~11; tree-sitter's CST counts every paren,
# brace, and keyword too, so a JS/Java equivalent runs larger still and a
# genuinely trivial JS stub (`function noop() {}`) sits at ~9 -- one
# language-agnostic cutoff between those two numbers (10) excludes the
# trivial case in both language families without excluding the smallest
# real function either. Not perfectly comparable across languages (a JS/
# Java function's punctuation inflates its count relative to Python's), but
# close enough that a single constant is a reasonable tradeoff over a
# separate per-language tuning exercise.
MIN_DUPLICATE_SHAPE_SIZE = 10

# Tree-sitter includes a comment as an ordinary node in the tree (verified
# directly against real parses, not assumed) -- JS/TS name it "comment";
# Java splits line vs. block comments into two distinct types. Excluded
# from the shape walk entirely (not just from the size count): two
# otherwise-identical functions that differ only by a comment being added,
# removed, or reworded in one copy must still hash the same, which is
# exactly the realistic case this feature exists to catch. Python needs no
# such list -- `ast` never retains comments in the first place, so there's
# nothing to strip.
_TREE_SITTER_COMMENT_TYPES = frozenset({"comment", "line_comment", "block_comment"})


class DuplicateGroup(BaseModel):
    node_ids: list[str]
    size: int


def _python_shape(node: ast.AST) -> tuple:
    children = tuple(_python_shape(child) for child in ast.iter_child_nodes(node))
    return (type(node).__name__, children)


def _tree_sitter_shape(node: tree_sitter.Node) -> tuple:
    children = tuple(
        _tree_sitter_shape(child)
        for child in node.children
        if child.type not in _TREE_SITTER_COMMENT_TYPES
    )
    return (node.type, children)


def _shape_size(shape: tuple) -> int:
    _label, children = shape
    return 1 + sum(_shape_size(child) for child in children)


def _shape_hash(shape: tuple) -> str:
    return hashlib.sha256(repr(shape).encode("utf-8")).hexdigest()


def build_duplicate_groups(result: ParseResult) -> list[DuplicateGroup]:
    """Groups `FUNCTION` nodes whose normalized AST shape hashes identically.
    Meant to be computed once per parse (see `RepoCache`), not recomputed per
    request -- the AST walk here costs about as much as `build_complexity_index`'s
    own walk."""
    root = Path(result.root)
    ast_trees: dict[str, ast.Module | None] = {}
    ast_indices: dict[str, ast_locate.DefIndex] = {}
    ts_trees: dict[str, tree_sitter.Tree | None] = {}
    ts_indices: dict[str, ts_locate.DefIndex] = {}
    java_trees: dict[str, tree_sitter.Tree | None] = {}
    java_indices: dict[str, java_locate.DefIndex] = {}

    node_ids_by_hash: dict[str, list[str]] = {}

    for node in result.nodes:
        if node.kind != NodeKind.FUNCTION:
            continue

        if _is_js_file(node.file):
            def_node = ts_locate.locate(root, node, ts_trees, ts_indices)
            if def_node is None:
                continue
            shape = _tree_sitter_shape(def_node)
        elif _is_java_file(node.file):
            def_node = java_locate.locate(root, node, java_trees, java_indices)
            if def_node is None:
                continue
            shape = _tree_sitter_shape(def_node)
        else:
            def_node = locate(root, node, ast_trees, ast_indices)
            if not isinstance(def_node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            shape = _python_shape(def_node)

        if _shape_size(shape) < MIN_DUPLICATE_SHAPE_SIZE:
            continue

        node_ids_by_hash.setdefault(_shape_hash(shape), []).append(node.id)

    groups = [
        DuplicateGroup(node_ids=sorted(node_ids), size=len(node_ids))
        for node_ids in node_ids_by_hash.values()
        if len(node_ids) >= 2
    ]
    groups.sort(key=lambda g: g.size, reverse=True)
    return groups
