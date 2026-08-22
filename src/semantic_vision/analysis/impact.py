"""Reverse caller index and upstream impact traversal (Milestone 5 /
TASK-07): given a target node, find everything that (transitively) calls
it, by walking `calls` edges backwards breadth-first.
"""

from __future__ import annotations

from collections import deque

from pydantic import BaseModel

from semantic_vision.models import Edge, EdgeKind

DEFAULT_MAX_DEPTH = 5


class Caller(BaseModel):
    id: str
    depth: int
    direct: bool


class ImpactResult(BaseModel):
    target: str
    callers: list[Caller]
    edges: list[Edge]
    cycles: list[list[str]]
    """Each entry is `[caller_id, callee_id]`: the edge that, when walked,
    would revisit a node already reached earlier in this traversal (the
    target itself or a shallower caller) -- the closing edge of a
    circular call chain, not the whole chain."""


def build_reverse_caller_index(edges: list[Edge]) -> dict[str, list[str]]:
    """Maps a node id to the ids of nodes with a `calls` edge into it,
    i.e. its direct callers. Meant to be built once per parsed repo
    (see `RepoCache`) rather than rebuilt on every impact query.
    """
    index: dict[str, list[str]] = {}
    for edge in edges:
        if edge.kind != EdgeKind.CALLS:
            continue
        index.setdefault(edge.target, []).append(edge.source)
    return index


def find_upstream_callers(
    target: str,
    reverse_index: dict[str, list[str]],
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> ImpactResult:
    """Breadth-first search over `reverse_index`, starting from `target`,
    up to `max_depth` hops.

    Each queue item carries the chain of ancestor ids (`target` down to
    its immediate callee) for that specific path, not just a single
    global "have we seen this node" flag -- so a genuine circular call
    chain (a node revisiting one of its own ancestors on the path back to
    `target`) is told apart from an ordinary diamond, where two different
    paths both converge on the same shared caller regardless of whether
    that convergence happens at the same depth or different depths. Only
    the former is reported in `cycles`; the latter is just a caller with
    more than one path to `target`, recorded once at its shallowest depth.

    `max_depth` alone bounds the traversal (depth strictly increases each
    level, and a path that closes a cycle is not expanded further), so a
    circular call chain can't loop forever.
    """
    callers: list[Caller] = []
    chain_edges: list[Edge] = []
    cycles: list[list[str]] = []
    seen_edges: set[tuple[str, str]] = set()
    depth_of: dict[str, int] = {target: 0}

    # Queue items: (node, callee, depth, ancestors), where `ancestors` is
    # the path from `target` down to `callee` (inclusive of `target`,
    # exclusive of `node`) specific to this traversal branch.
    queue: deque[tuple[str, str, int, tuple[str, ...]]] = deque(
        (caller, target, 1, (target,)) for caller in reverse_index.get(target, [])
    )

    while queue:
        node, callee, depth, ancestors = queue.popleft()

        edge_key = (node, callee)
        if edge_key not in seen_edges:
            seen_edges.add(edge_key)
            chain_edges.append(Edge(source=node, target=callee, kind=EdgeKind.CALLS))

        if node in ancestors:
            # `node` already appears earlier on this specific path back to
            # `target` -- a genuine circular call chain. Don't expand it
            # further (that would just re-walk the same cycle).
            cycles.append([node, callee])
            continue

        if node not in depth_of:
            depth_of[node] = depth
            callers.append(Caller(id=node, depth=depth, direct=(depth == 1)))

        if depth >= max_depth:
            continue

        new_ancestors = (*ancestors, node)
        for caller_of_node in reverse_index.get(node, []):
            queue.append((caller_of_node, node, depth + 1, new_ancestors))

    callers.sort(key=lambda caller: (caller.depth, caller.id))
    return ImpactResult(target=target, callers=callers, edges=chain_edges, cycles=cycles)
