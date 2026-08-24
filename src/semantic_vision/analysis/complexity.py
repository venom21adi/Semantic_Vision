"""Function-level complexity scoring (Milestone 9a / V2): a per-function
cyclomatic complexity count and forward-call-chain depth, computed once
per parse and exposed for a heatmap overlay and ranked report (Milestone
9c) via a repo-wide endpoint (Milestone 9b).

Kept deliberately separate from `flowchart.cfg`: that module builds a full
rendered flowchart (nodes/edges/labels) for one function at a time; this
only needs a scalar complexity count for every function in a repo, which a
dedicated lightweight AST walk computes far more cheaply than building and
counting a full flowchart per function would.
"""

from __future__ import annotations

import ast
from pathlib import Path

from pydantic import BaseModel

from semantic_vision.ast_locate import locate
from semantic_vision.models import Edge, EdgeKind, NodeKind, ParseResult

# Matches `analysis.impact.DEFAULT_MAX_DEPTH`, for consistency across the
# two traversals -- not imported from there, since the two constants are
# free to diverge later and this keeps `analysis.impact` and
# `analysis.complexity` independent modules.
DEFAULT_MAX_CALL_CHAIN_DEPTH = 5

_DECISION_NODE_TYPES = (
    ast.If | ast.IfExp | ast.For | ast.AsyncFor | ast.While | ast.ExceptHandler
)
_LOOP_NODE_TYPES = ast.For | ast.AsyncFor | ast.While
_NESTED_SCOPE_TYPES = ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef


class ComplexityScore(BaseModel):
    node_id: str
    cyclomatic_complexity: int
    call_chain_depth: int
    has_nested_loops: bool


def build_forward_call_index(edges: list[Edge]) -> dict[str, list[str]]:
    """Maps a node id to the ids of nodes it has a `calls` edge to, i.e.
    its direct callees -- the opposite direction of
    `analysis.impact.build_reverse_caller_index`. Meant to be built once
    per parsed repo (see `RepoCache`), not rebuilt on every query.
    """
    index: dict[str, list[str]] = {}
    for edge in edges:
        if edge.kind != EdgeKind.CALLS:
            continue
        index.setdefault(edge.source, []).append(edge.target)
    return index


def _call_chain_depth(node_id: str, forward_index: dict[str, list[str]], max_depth: int) -> int:
    """Depth-first walk over `node_id`'s callee chain, returning the
    longest chain length found (0 if it has no callees).

    Mirrors `find_upstream_callers`'s own cycle-safety: `ancestors` is
    scoped to the *current path* (from `node_id` down to the node being
    expanded), not global, so two independent branches that both reach
    the same callee don't suppress one another, while a genuine cycle
    stops that branch rather than looping forever. `max_depth` bounds the
    walk independently of cycle detection, for the same reason
    `find_upstream_callers` caps its own traversal.
    """
    deepest = 0
    stack: list[tuple[str, int, frozenset[str]]] = [(node_id, 0, frozenset({node_id}))]
    while stack:
        current, depth, ancestors = stack.pop()
        deepest = max(deepest, depth)
        if depth >= max_depth:
            continue
        for callee in forward_index.get(current, []):
            if callee in ancestors:
                continue  # cycle on this path -- don't expand it further
            stack.append((callee, depth + 1, ancestors | {callee}))
    return deepest


def _is_wildcard_pattern(pattern: ast.pattern) -> bool:
    """`case _:` -- Python represents the wildcard pattern as a bare
    `MatchAs` with no sub-pattern and no capture name, which is otherwise
    indistinguishable in shape from a capture pattern like `case x:`
    (also a bare `MatchAs`) except for the missing `name`.
    """
    return isinstance(pattern, ast.MatchAs) and pattern.pattern is None and pattern.name is None


def _cyclomatic_complexity(def_node: ast.FunctionDef | ast.AsyncFunctionDef) -> tuple[int, bool]:
    """McCabe cyclomatic complexity for a single function body: +1 per
    `If`/`IfExp` (a ternary `x if cond else y` is a decision point just
    like a statement-level `if`)/`For`/`AsyncFor`/`While`/`ExceptHandler`,
    +1 per extra `BoolOp` operand (`a and b and c` has 2 extra decision
    points, not 1), +1 per comprehension `if` clause, +1 per non-wildcard
    `match` case (a case's guard clause, if any, does not add its own
    point); base complexity is 1 + that count.

    Also reports whether the function contains a loop nested inside
    another loop, as a separate `has_nested_loops` flag rather than
    folding it into the count -- "a loop inside a loop" is a
    qualitatively different warning sign (potential O(n^2)+) than an
    equal-magnitude but flat chain of independent branches.

    Walks only this function's own body: a nested `def`/`class`
    statement is not descended into, since it's scored separately as its
    own node -- it shouldn't inflate its enclosing function's score,
    matching how `flowchart.cfg` treats a nested def as a single opaque
    statement rather than descending into it. A `lambda`, which has no
    node of its own in the graph, is descended into normally.
    """
    complexity = 1
    loop_depth = 0
    max_loop_depth = 0

    def visit(node: ast.AST) -> None:
        nonlocal complexity, loop_depth, max_loop_depth
        is_loop = isinstance(node, _LOOP_NODE_TYPES)

        if isinstance(node, _DECISION_NODE_TYPES):
            complexity += 1
        elif isinstance(node, ast.BoolOp):
            complexity += len(node.values) - 1
        elif isinstance(node, ast.comprehension):
            complexity += len(node.ifs)
        elif isinstance(node, ast.Match):
            complexity += sum(1 for case in node.cases if not _is_wildcard_pattern(case.pattern))

        if is_loop:
            loop_depth += 1
            max_loop_depth = max(max_loop_depth, loop_depth)

        for child in ast.iter_child_nodes(node):
            if not isinstance(child, _NESTED_SCOPE_TYPES):
                visit(child)

        if is_loop:
            loop_depth -= 1

    for child in ast.iter_child_nodes(def_node):
        if not isinstance(child, _NESTED_SCOPE_TYPES):
            visit(child)

    return complexity, max_loop_depth >= 2


def build_complexity_index(
    result: ParseResult, max_call_chain_depth: int = DEFAULT_MAX_CALL_CHAIN_DEPTH
) -> dict[str, ComplexityScore]:
    """Computes a complexity score for every `FUNCTION` node in a parsed
    repo. Meant to be computed once per parse (see `RepoCache`), not
    recomputed per request.
    """
    root = Path(result.root)
    trees: dict[str, ast.Module | None] = {}
    forward_index = build_forward_call_index(result.edges)

    scores: dict[str, ComplexityScore] = {}
    for node in result.nodes:
        if node.kind != NodeKind.FUNCTION:
            continue

        depth = _call_chain_depth(node.id, forward_index, max_call_chain_depth)
        def_node = locate(root, node, trees)
        if not isinstance(def_node, ast.FunctionDef | ast.AsyncFunctionDef):
            # Source unavailable or unparseable -- degrade to a minimal
            # score rather than skipping the node or erroring the whole
            # index, matching `flowchart.build_flowchart`'s own fallback
            # for the same condition.
            scores[node.id] = ComplexityScore(
                node_id=node.id,
                cyclomatic_complexity=1,
                call_chain_depth=depth,
                has_nested_loops=False,
            )
            continue

        complexity, has_nested_loops = _cyclomatic_complexity(def_node)
        scores[node.id] = ComplexityScore(
            node_id=node.id,
            cyclomatic_complexity=complexity,
            call_chain_depth=depth,
            has_nested_loops=has_nested_loops,
        )
    return scores
