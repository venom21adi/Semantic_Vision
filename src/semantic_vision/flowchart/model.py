"""Language-neutral flowchart data shapes and graph-building machinery,
shared by `flowchart/cfg.py` (Python) and `flowchart/ts_cfg.py` (JS/TS).

Split out from `cfg.py` specifically so the two per-language builder
modules can both depend on this without either depending on the other --
`cfg.py` dispatches to `ts_cfg.py` for JS/TS files (mirroring
`analysis/complexity.py`'s own per-file-kind dispatch), so `ts_cfg.py`
importing back from `cfg.py` would be circular. Nothing here is
Python-specific or JS/TS-specific: `FlowNode`/`FlowEdge` are the wire
shapes the API serves either language's flowchart through unchanged, and
`_Builder`/`_PendingExit` are pure id/edge bookkeeping over abstract
node kinds and line numbers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from pydantic import BaseModel


class FlowNodeKind(StrEnum):
    ENTRY = "entry"
    RETURN = "return"
    STATEMENT = "statement"
    CALL = "call"
    DECISION = "decision"
    LOOP = "loop"
    IO = "io"


class FlowEdgeKind(StrEnum):
    FLOW = "flow"
    TRUE = "true"
    FALSE = "false"
    LOOP_BACK = "loop_back"


class FlowNode(BaseModel):
    id: str
    kind: FlowNodeKind
    label: str
    line: int
    end_line: int


class FlowEdge(BaseModel):
    source: str
    target: str
    kind: FlowEdgeKind
    label: str | None = None


class FlowchartResult(BaseModel):
    target: str
    entry: str
    nodes: list[FlowNode]
    edges: list[FlowEdge]


def truncate_label(text: str) -> str:
    first, *rest = text.splitlines() or [""]
    return f"{first} …" if rest else first


# A pending exit: a node awaiting a successor, plus the edge kind/label to
# use once one is available (an `if` with no `else`, or a loop's normal
# exit, can't wire its outgoing edge until the caller supplies what comes
# next in the enclosing block).
PendingExit = tuple[str, FlowEdgeKind, str | None]


class Builder:
    def __init__(self, prefix: str) -> None:
        self._prefix = prefix
        self._counter = 0
        self.nodes: list[FlowNode] = []
        self.edges: list[FlowEdge] = []

    def add_node(self, kind: FlowNodeKind, label: str, line: int, end_line: int) -> str:
        node_id = f"{self._prefix}::n{self._counter}"
        self._counter += 1
        self.nodes.append(
            FlowNode(
                id=node_id,
                kind=kind,
                label=truncate_label(label),
                line=line,
                end_line=end_line,
            )
        )
        return node_id

    def add_edge(
        self,
        source: str,
        target: str,
        kind: FlowEdgeKind = FlowEdgeKind.FLOW,
        label: str | None = None,
    ) -> None:
        self.edges.append(FlowEdge(source=source, target=target, kind=kind, label=label))

    def connect(self, exits: list[PendingExit], target: str) -> None:
        for source, kind, label in exits:
            self.add_edge(source, target, kind, label)


@dataclass
class LoopCtx:
    """A breakable/continuable context: a loop, or (JS/TS-only, `kind`
    distinguishes them) a `switch`. `header` is the `continue` target --
    `None` for a switch, since `continue` never targets one. `label` is
    the JS/TS labeled-statement name this context was entered under, if
    any (always `None` for Python, which has no labeled break/continue).
    Kept here, not in either builder module, since Python's own loop
    handling uses it too (via the `kind="loop"` case only)."""

    header: str | None
    kind: str = "loop"
    label: str | None = None
    pending_breaks: list[PendingExit] = field(default_factory=list)
