"""Reverse caller index and upstream impact traversal (Milestone 5 /
TASK-07): given a target node, find everything that (transitively) calls
it, by walking `calls` edges backwards breadth-first.
"""

from __future__ import annotations

from collections import deque

from pydantic import BaseModel

from semantic_vision.models import Edge, EdgeKind

DEFAULT_MAX_DEPTH = 5

_TRAVERSABLE_EDGE_KINDS = frozenset(
    {
        EdgeKind.CALLS,
        EdgeKind.MAPS_TO,
        EdgeKind.FOREIGN_KEY,
        EdgeKind.REFERENCES,
        EdgeKind.MATERIALIZES,
        EdgeKind.READS,
        EdgeKind.WRITES,
    }
)
"""What "upstream caller" means for impact analysis, widened past plain
function calls (Milestone 17) so a table/column/dbt-model node's impact
traversal actually crosses into code, matching what the UI has claimed
since 17a-17d ("impact analysis works on a table node exactly like a
function") -- a claim `build_reverse_caller_index` never actually lived up
to, since it only ever indexed `CALLS` edges: right-clicking a table
returned zero callers. Deliberately excludes `DEFINES` (containment -- a
table containing a column isn't the column's "caller") and `IMPORTS` (a
file importing another isn't a dependency in this sense either), the same
two kinds already excluded by omission before this change."""


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


def build_reverse_caller_index(edges: list[Edge]) -> dict[str, list[tuple[str, EdgeKind]]]:
    """Maps a node id to the `(source, kind)` of every edge in
    `_TRAVERSABLE_EDGE_KINDS` that points into it, i.e. its direct
    "callers" in the broader upstream-impact sense. The kind is carried
    along (not just the id) so `find_upstream_callers` can report each
    hop's real edge kind in `ImpactResult.edges` instead of mislabeling a
    `reads`/`writes`/`maps_to` hop as `calls`. Meant to be built once per
    parsed repo (see `RepoCache`) rather than rebuilt on every impact
    query.
    """
    index: dict[str, list[tuple[str, EdgeKind]]] = {}
    for edge in edges:
        if edge.kind not in _TRAVERSABLE_EDGE_KINDS:
            continue
        index.setdefault(edge.target, []).append((edge.source, edge.kind))
    return index


def find_upstream_callers(
    target: str,
    reverse_index: dict[str, list[tuple[str, EdgeKind]]],
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

    # Queue items: (node, callee, kind, depth, ancestors), where `kind` is
    # the real kind of the `node -> callee` edge (a `calls` hop and a
    # `reads`/`writes`/`maps_to` hop are told apart in the returned
    # `ImpactResult.edges`, not all flattened to `calls`) and `ancestors`
    # is the path from `target` down to `callee` (inclusive of `target`,
    # exclusive of `node`) specific to this traversal branch.
    queue: deque[tuple[str, str, EdgeKind, int, tuple[str, ...]]] = deque(
        (caller, target, kind, 1, (target,)) for caller, kind in reverse_index.get(target, [])
    )

    while queue:
        node, callee, kind, depth, ancestors = queue.popleft()

        edge_key = (node, callee)
        if edge_key not in seen_edges:
            seen_edges.add(edge_key)
            chain_edges.append(Edge(source=node, target=callee, kind=kind))

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
        for caller_of_node, edge_kind in reverse_index.get(node, []):
            queue.append((caller_of_node, node, edge_kind, depth + 1, new_ancestors))

    callers.sort(key=lambda caller: (caller.depth, caller.id))
    return ImpactResult(target=target, callers=callers, edges=chain_edges, cycles=cycles)
