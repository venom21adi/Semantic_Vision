"""Control-flow representation for a single function (Milestone 7 /
TASK-09): given a target function node, re-parses its owning file,
locates its exact AST, and walks its body to build a flowchart-shaped
graph of entry/return/decision/loop/I-O/call nodes connected by flow
edges.

Kept deliberately separate from `analysis.impact` (call-graph traversal
across the whole resolved graph) since this operates at statement
granularity within a single function's body.
"""

from __future__ import annotations

import ast
import copy
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel

from semantic_vision.ast_locate import DefNode, locate
from semantic_vision.models import NodeKind, ParseResult


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


_IO_BUILTIN_NAMES = {"print", "input", "open"}
_IO_METHOD_NAMES = {"read", "write", "readline", "readlines", "close"}


def _render_signature(def_node: DefNode) -> str:
    stripped = copy.copy(def_node)
    stripped.body = [ast.Pass()]
    stripped.decorator_list = []
    try:
        rendered = ast.unparse(stripped)
    except (ValueError, TypeError):
        return f"def {def_node.name}(...):"
    return rendered.splitlines()[0]


def _end_line(stmt: ast.stmt) -> int:
    return getattr(stmt, "end_lineno", None) or stmt.lineno


def _add_stmt_node(builder: _Builder, kind: FlowNodeKind, stmt: ast.stmt) -> str:
    return builder.add_node(kind, _unparse_stmt(stmt), stmt.lineno, _end_line(stmt))


def _truncate_label(text: str) -> str:
    first, *rest = text.splitlines() or [""]
    return f"{first} …" if rest else first


def _unparse_stmt(stmt: ast.stmt) -> str:
    try:
        return ast.unparse(stmt)
    except (ValueError, TypeError):
        return type(stmt).__name__


def _index_same_file_functions(result: ParseResult, file: str) -> dict[str, str]:
    """Maps a function's simple (unqualified) name to its node id, for
    every name that's unambiguous within this file -- a name used by two
    different functions/methods in the same file (e.g. two classes each
    with a `helper` method) is excluded entirely, since a bare `self.helper()`
    call-site can't be resolved to one of them by name alone."""
    counts: dict[str, int] = {}
    first_id: dict[str, str] = {}
    for candidate in result.nodes:
        if candidate.file != file or candidate.kind != NodeKind.FUNCTION:
            continue
        counts[candidate.label] = counts.get(candidate.label, 0) + 1
        first_id.setdefault(candidate.label, candidate.id)
    return {label: node_id for label, node_id in first_id.items() if counts[label] == 1}


def _dotted_callee_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _classify_call(call: ast.Call, same_file_functions: dict[str, str]) -> FlowNodeKind:
    name = _dotted_callee_name(call.func)
    if name is None:
        return FlowNodeKind.STATEMENT
    if isinstance(call.func, ast.Name) and name in _IO_BUILTIN_NAMES:
        return FlowNodeKind.IO
    if isinstance(call.func, ast.Attribute) and name in _IO_METHOD_NAMES:
        return FlowNodeKind.IO
    if name in same_file_functions:
        return FlowNodeKind.CALL
    return FlowNodeKind.STATEMENT


# A pending exit: a node awaiting a successor, plus the edge kind/label to
# use once one is available (an `if` with no `else`, or a loop's normal
# exit, can't wire its outgoing edge until the caller supplies what comes
# next in the enclosing block).
_PendingExit = tuple[str, FlowEdgeKind, str | None]


@dataclass
class _LoopCtx:
    header: str
    pending_breaks: list[_PendingExit] = field(default_factory=list)


class _Builder:
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
                label=_truncate_label(label),
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

    def connect(self, exits: list[_PendingExit], target: str) -> None:
        for source, kind, label in exits:
            self.add_edge(source, target, kind, label)


def _build_block(
    builder: _Builder,
    stmts: list[ast.stmt],
    loop_ctx: _LoopCtx | None,
    same_file_functions: dict[str, str],
) -> tuple[str | None, list[_PendingExit]]:
    first_id: str | None = None
    pending: list[_PendingExit] = []
    for stmt in stmts:
        entry_id, stmt_pending = _build_stmt(builder, stmt, loop_ctx, same_file_functions)
        if first_id is None:
            first_id = entry_id
        if pending:
            builder.connect(pending, entry_id)
        pending = stmt_pending
    return first_id, pending


def _build_if(
    builder: _Builder,
    stmt: ast.If,
    loop_ctx: _LoopCtx | None,
    same_file_functions: dict[str, str],
) -> tuple[str, list[_PendingExit]]:
    label = f"if {ast.unparse(stmt.test)}"
    decision_id = builder.add_node(FlowNodeKind.DECISION, label, stmt.lineno, _end_line(stmt))

    true_first, true_pending = _build_block(builder, stmt.body, loop_ctx, same_file_functions)
    assert true_first is not None  # an `if` body always has >=1 statement in valid Python
    builder.add_edge(decision_id, true_first, FlowEdgeKind.TRUE, "Yes")

    if stmt.orelse:
        false_first, false_pending = _build_block(
            builder, stmt.orelse, loop_ctx, same_file_functions
        )
        assert false_first is not None
        builder.add_edge(decision_id, false_first, FlowEdgeKind.FALSE, "No")
        pending = true_pending + false_pending
    else:
        pending = [*true_pending, (decision_id, FlowEdgeKind.FALSE, "No")]

    return decision_id, pending


def _build_loop(
    builder: _Builder,
    stmt: ast.For | ast.AsyncFor | ast.While,
    loop_ctx: _LoopCtx | None,
    same_file_functions: dict[str, str],
) -> tuple[str, list[_PendingExit]]:
    if isinstance(stmt, ast.While):
        label = f"while {ast.unparse(stmt.test)}"
    else:
        label = f"for {ast.unparse(stmt.target)} in {ast.unparse(stmt.iter)}"
    header_id = builder.add_node(FlowNodeKind.LOOP, label, stmt.lineno, _end_line(stmt))

    inner_ctx = _LoopCtx(header=header_id)
    body_first, body_pending = _build_block(builder, stmt.body, inner_ctx, same_file_functions)
    assert body_first is not None  # a loop body always has >=1 statement in valid Python
    builder.add_edge(header_id, body_first, FlowEdgeKind.FLOW, "Loop")
    for source, _kind, _label in body_pending:
        builder.add_edge(source, header_id, FlowEdgeKind.LOOP_BACK)

    # `break` skips a loop's `else:` clause entirely (Python semantics),
    # so it's merged in below rather than routed through the orelse wiring.
    if stmt.orelse:
        else_first, else_pending = _build_block(builder, stmt.orelse, loop_ctx, same_file_functions)
        assert else_first is not None
        builder.add_edge(header_id, else_first, FlowEdgeKind.FLOW, "Done")
        exits = else_pending
    else:
        exits = [(header_id, FlowEdgeKind.FLOW, "Done")]

    return header_id, [*exits, *inner_ctx.pending_breaks]


def _build_stmt(
    builder: _Builder,
    stmt: ast.stmt,
    loop_ctx: _LoopCtx | None,
    same_file_functions: dict[str, str],
) -> tuple[str, list[_PendingExit]]:
    if isinstance(stmt, ast.If):
        return _build_if(builder, stmt, loop_ctx, same_file_functions)

    if isinstance(stmt, ast.For | ast.AsyncFor | ast.While):
        return _build_loop(builder, stmt, loop_ctx, same_file_functions)

    if isinstance(stmt, ast.Return):
        node_id = _add_stmt_node(builder, FlowNodeKind.RETURN, stmt)
        return node_id, []

    if isinstance(stmt, ast.Raise):
        # Terminal: code after `raise` is unreachable, so no exit is drawn.
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, []

    if isinstance(stmt, ast.Break):
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "break", stmt.lineno, _end_line(stmt))
        if loop_ctx is not None:
            loop_ctx.pending_breaks.append((node_id, FlowEdgeKind.FLOW, None))
        return node_id, []

    if isinstance(stmt, ast.Continue):
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "continue", stmt.lineno, _end_line(stmt))
        if loop_ctx is not None:
            builder.add_edge(node_id, loop_ctx.header, FlowEdgeKind.LOOP_BACK)
        return node_id, []

    if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
        kind = _classify_call(stmt.value, same_file_functions)
        node_id = _add_stmt_node(builder, kind, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    # Every other statement kind (Assign/AnnAssign/AugAssign/Pass/Import/
    # With/AsyncWith/Try/Match/nested def or class/etc.) becomes one
    # opaque node rather than being descended into -- With/Try/Match have
    # real branching/exception semantics that a flattened "unpack the body
    # sequentially" treatment would misrepresent, so they're deliberately
    # kept as a single node instead of partially and incorrectly modeled.
    node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def build_flowchart(result: ParseResult, node_id: str) -> FlowchartResult:
    """Assumes `node_id` refers to an existing `FUNCTION` node -- callers
    (the `/api/flowchart` route) are expected to validate that first, the
    same division of responsibility `analysis.impact.find_upstream_callers`
    and `ai.context.assemble_context` use.
    """
    root = Path(result.root)
    nodes_by_id = {n.id: n for n in result.nodes}
    node = nodes_by_id[node_id]
    trees: dict[str, ast.Module | None] = {}

    builder = _Builder(node_id)
    def_node = locate(root, node, trees)

    if def_node is None:
        # Source unavailable or unparseable -- degrade to a minimal,
        # still-valid two-node flowchart rather than erroring.
        entry_id = builder.add_node(
            FlowNodeKind.ENTRY, f"def {node.label}(...):", node.line_start, node.line_start
        )
        return_id = builder.add_node(
            FlowNodeKind.RETURN, "return (implicit)", node.line_end, node.line_end
        )
        builder.add_edge(entry_id, return_id)
        return FlowchartResult(
            target=node_id, entry=entry_id, nodes=builder.nodes, edges=builder.edges
        )

    entry_id = builder.add_node(
        FlowNodeKind.ENTRY, _render_signature(def_node), def_node.lineno, def_node.lineno
    )
    same_file_functions = _index_same_file_functions(result, node.file)

    body_first, pending = _build_block(builder, def_node.body, None, same_file_functions)
    assert body_first is not None  # a function body always has >=1 statement in valid Python
    builder.add_edge(entry_id, body_first)

    if pending:
        end_line = def_node.end_lineno or def_node.lineno
        return_id = builder.add_node(FlowNodeKind.RETURN, "return (implicit)", end_line, end_line)
        builder.connect(pending, return_id)

    return FlowchartResult(target=node_id, entry=entry_id, nodes=builder.nodes, edges=builder.edges)
