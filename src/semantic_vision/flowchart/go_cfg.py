"""Go control-flow representation -- the tree-sitter analogue of
`flowchart/java_cfg.py`, for a Go function/method body. Every node shape
and field name below was confirmed against live tree-sitter-go output, the
same discipline `java_cfg.py` documents.

Reuses `flowchart.model`'s language-neutral `Builder`/`PendingExit`/
`LoopCtx` machinery directly. Where Go differs from Java:

- **One loop keyword.** `for_statement` covers `for {}`, `for cond {}`,
  three-clause `for`, and `for ... range`; all are the same "condition
  before body" shape, labelled with the statement's own header text.
- **Blocks wrap a `statement_list`**, and comments appear as ordinary named
  nodes (filtered out here so a comment never becomes a flowchart node).
- **Three switch-like statements**: `expression_switch_statement`,
  `type_switch_statement`, and `select_statement`, with `expression_case`/
  `type_case`/`communication_case`/`default_case` children carrying their
  own statements. One builder serves all three.
- **No implicit fallthrough.** A case ends the switch unless its last
  statement is an explicit `fallthrough`, the opposite of Java/JS. `select`
  with no `default` blocks rather than falling through, so it gets no
  "no match" exit.
- `defer`/`go` statements wrap one call and become call/statement nodes in
  place; `goto` and labeled non-loop statements are opaque (not modeled),
  same "don't partially/incorrectly model" stance as `try`/`catch` elsewhere.
"""

from __future__ import annotations

import tree_sitter

from semantic_vision.flowchart.model import (
    Builder,
    FlowEdgeKind,
    FlowNodeKind,
    LoopCtx,
    PendingExit,
)
from semantic_vision.parser.go_extractor import _dotted_name, _end_line, _line, _text

TSNode = tree_sitter.Node

end_line = _end_line
"""Re-exported so `flowchart/cfg.py` needs no import of the extractor's
private helper for the implicit-return line."""

_IO_METHOD_NAMES = frozenset(
    {
        # fmt
        "Println", "Printf", "Print", "Fprintf", "Fprintln", "Fprint",
        "Scan", "Scanf", "Scanln",
        # log
        "Fatal", "Fatalf", "Fatalln",
        # io / os / bufio
        "Write", "WriteString", "Read", "ReadAll", "ReadFile", "WriteFile",
        "ReadLine", "ReadString", "Open", "Create", "Close", "Flush", "Copy",
        "ListenAndServe",
    }
)  # fmt: skip
_IO_PACKAGE_NAMES = frozenset({"fmt", "log", "os", "io", "ioutil", "bufio", "http"})

_CASE_TYPES = frozenset({"expression_case", "type_case", "communication_case", "default_case"})
_SWITCH_TYPES = frozenset(
    {"expression_switch_statement", "type_switch_statement", "select_statement"}
)


def _classify_call(
    callee: TSNode | None, dotted: str | None, same_file_functions: dict[str, str]
) -> FlowNodeKind:
    """Name-only, not receiver-aware -- the same accepted heuristic risk
    every other language's `_classify_call` documents. Package-qualified
    `fmt.Println`-style calls and a short list of well-known I/O method
    names classify as `IO`; a bare name defined in this same file is a
    `CALL`."""
    if dotted is None or callee is None:
        return FlowNodeKind.STATEMENT
    root, _, rest = dotted.partition(".")
    trailing = dotted.rsplit(".", 1)[-1]
    if callee.type == "selector_expression" and (
        trailing in _IO_METHOD_NAMES or (rest and root in _IO_PACKAGE_NAMES)
    ):
        return FlowNodeKind.IO
    if trailing in same_file_functions:
        return FlowNodeKind.CALL
    return FlowNodeKind.STATEMENT


def _statements(container: TSNode | None) -> list[TSNode]:
    """The real statements inside a `block` (via its `statement_list`) or a
    case node, with comments dropped."""
    if container is None:
        return []
    if container.type == "block":
        lists = [c for c in container.named_children if c.type == "statement_list"]
        stmts = lists[0].named_children if lists else []
    elif container.type == "statement_list":
        stmts = container.named_children
    else:
        lists = [c for c in container.named_children if c.type == "statement_list"]
        stmts = lists[0].named_children if lists else []
    return [s for s in stmts if s.type != "comment"]


def _header_text(stmt: TSNode, body: TSNode) -> str:
    """The statement's own source up to (not including) its body block."""
    return stmt.text[: body.start_byte - stmt.start_byte].decode("utf-8").strip()


def _add_stmt_node(builder: Builder, kind: FlowNodeKind, stmt: TSNode) -> str:
    return builder.add_node(kind, _text(stmt) or stmt.type, _line(stmt), _end_line(stmt))


def _find_breakable(
    stack: list[LoopCtx], label: str | None, *, require_loop: bool
) -> LoopCtx | None:
    for ctx in reversed(stack):
        if label is None:
            if not require_loop or ctx.kind == "loop":
                return ctx
        elif ctx.label == label and (not require_loop or ctx.kind == "loop"):
            return ctx
    return None


def _build_block(
    builder: Builder,
    stmts: list[TSNode],
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str | None, list[PendingExit]]:
    first_id: str | None = None
    pending: list[PendingExit] = []
    for stmt in stmts:
        entry_id, stmt_pending = _build_stmt(builder, stmt, breakable_stack, same_file_functions)
        if first_id is None:
            first_id = entry_id
        if pending:
            builder.connect(pending, entry_id)
        pending = stmt_pending
    return first_id, pending


def _build_body(
    builder: Builder,
    body: TSNode | None,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    """A branch/loop body. Go allows an empty `{}` here (unlike Java's
    always->=1-statement assumption), which becomes one `{}` placeholder
    node so the branch still has something to connect to."""
    first, pending = _build_block(builder, _statements(body), breakable_stack, same_file_functions)
    if first is None:
        line = _line(body) if body is not None else 0
        end = _end_line(body) if body is not None else 0
        first = builder.add_node(FlowNodeKind.STATEMENT, "{}", line, end)
        pending = [(first, FlowEdgeKind.FLOW, None)]
    return first, pending


def _build_if(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    consequence = stmt.child_by_field_name("consequence")
    label = _header_text(stmt, consequence) if consequence is not None else "if"
    decision_id = builder.add_node(FlowNodeKind.DECISION, label, _line(stmt), _end_line(stmt))

    true_first, true_pending = _build_body(
        builder, consequence, breakable_stack, same_file_functions
    )
    builder.add_edge(decision_id, true_first, FlowEdgeKind.TRUE, "Yes")

    alternative = stmt.child_by_field_name("alternative")
    if alternative is not None:
        # Directly another `if_statement` (else-if) or the plain else block.
        is_else_if = alternative.type == "if_statement"
        alt_stmts = [alternative] if is_else_if else _statements(alternative)
        false_first, false_pending = _build_block(
            builder, alt_stmts, breakable_stack, same_file_functions
        )
        if false_first is None:
            false_first = builder.add_node(
                FlowNodeKind.STATEMENT, "{}", _line(alternative), _end_line(alternative)
            )
            false_pending = [(false_first, FlowEdgeKind.FLOW, None)]
        builder.add_edge(decision_id, false_first, FlowEdgeKind.FALSE, "No")
        pending = true_pending + false_pending
    else:
        pending = [*true_pending, (decision_id, FlowEdgeKind.FALSE, "No")]
    return decision_id, pending


def _build_for(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None,
) -> tuple[str, list[PendingExit]]:
    body = stmt.child_by_field_name("body")
    header_label = _header_text(stmt, body) if body is not None else "for"
    header_id = builder.add_node(FlowNodeKind.LOOP, header_label, _line(stmt), _end_line(stmt))

    inner_ctx = LoopCtx(header=header_id, label=label)
    breakable_stack.append(inner_ctx)
    body_first, body_pending = _build_body(builder, body, breakable_stack, same_file_functions)
    breakable_stack.pop()

    builder.add_edge(header_id, body_first, FlowEdgeKind.FLOW, "Loop")
    for source, _kind, _label in body_pending:
        builder.add_edge(source, header_id, FlowEdgeKind.LOOP_BACK)

    # `for {}` / `for { ... }` with no condition only exits via `break`.
    infinite = all(c.type in ("block", "comment") for c in stmt.named_children)
    exits = list(inner_ctx.pending_breaks)
    if not infinite:
        exits.insert(0, (header_id, FlowEdgeKind.FLOW, "Done"))
    return header_id, exits


def _case_label(case: TSNode) -> str:
    if case.type == "default_case":
        return "default"
    stmts = [c for c in case.named_children if c.type == "statement_list"]
    end = stmts[0].start_byte if stmts else case.end_byte
    text = case.text[: end - case.start_byte].decode("utf-8").strip()
    return " ".join(text.removesuffix(":").split())


def _build_switch(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None = None,
) -> tuple[str, list[PendingExit]]:
    cases = [c for c in stmt.named_children if c.type in _CASE_TYPES]
    first_case = cases[0] if cases else None
    header_end = first_case.start_byte if first_case is not None else stmt.end_byte
    header = stmt.text[: header_end - stmt.start_byte].decode("utf-8").strip()
    header = " ".join(header.removesuffix("{").split()) or stmt.type.split("_")[0]
    decision_id = builder.add_node(FlowNodeKind.DECISION, header, _line(stmt), _end_line(stmt))

    switch_ctx = LoopCtx(header=None, kind="switch", label=label)
    breakable_stack.append(switch_ctx)

    # (is_default, label, first node, pending exits, ends in `fallthrough`)
    built: list[tuple[bool, str, str | None, list[PendingExit], bool]] = []
    for case in cases:
        stmts = _statements(case)
        falls_through = bool(stmts) and stmts[-1].type == "fallthrough_statement"
        if falls_through:
            stmts = stmts[:-1]
        first, pending = _build_block(builder, stmts, breakable_stack, same_file_functions)
        if falls_through and first is None:
            # Nothing but `fallthrough`: no node of its own, forwarded below.
            pending = []
        is_default = case.type == "default_case"
        built.append((is_default, _case_label(case), first, pending, falls_through))

    breakable_stack.pop()

    # Unlike Java/JS, Go never falls into the next case implicitly: an empty
    # case does nothing and leaves the switch. Only an explicit
    # `fallthrough` forwards control, to the next case's first node -- or
    # past it, if that case is itself empty but also falls through.
    def entry_of(i: int) -> str | None:
        while i < len(built):
            first = built[i][2]
            if first is not None:
                return first
            if not built[i][4]:
                return None
            i += 1
        return None

    switch_exits: list[PendingExit] = list(switch_ctx.pending_breaks)
    for i, (_is_default, case_label, _first, pending, falls_through) in enumerate(built):
        target = entry_of(i)
        if target is not None:
            builder.add_edge(decision_id, target, FlowEdgeKind.FLOW, case_label)
        else:
            switch_exits.append((decision_id, FlowEdgeKind.FLOW, case_label))
        next_target = entry_of(i + 1) if falls_through else None
        if next_target is not None:
            builder.connect(pending, next_target)
        else:
            switch_exits.extend(pending)

    has_default = any(is_default for is_default, *_ in built)
    if stmt.type != "select_statement" and not has_default:
        switch_exits.append((decision_id, FlowEdgeKind.FLOW, "no match"))
    return decision_id, switch_exits


def _call_stmt(
    builder: Builder, stmt: TSNode, call: TSNode, same_file_functions: dict[str, str]
) -> tuple[str, list[PendingExit]]:
    callee = call.child_by_field_name("function")
    kind = _classify_call(callee, _dotted_name(callee), same_file_functions)
    node_id = _add_stmt_node(builder, kind, stmt)
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def _build_stmt(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None = None,
) -> tuple[str, list[PendingExit]]:
    if stmt.type == "if_statement":
        return _build_if(builder, stmt, breakable_stack, same_file_functions)

    if stmt.type == "for_statement":
        return _build_for(builder, stmt, breakable_stack, same_file_functions, label)

    if stmt.type in _SWITCH_TYPES:
        return _build_switch(builder, stmt, breakable_stack, same_file_functions, label)

    if stmt.type == "labeled_statement":
        label_node = stmt.child_by_field_name("label")
        wrapped = next(
            (c for c in stmt.named_children if c.type != "label_name" and c.type != "comment"),
            None,
        )
        if wrapped is not None:
            # The label only matters as a `break`/`continue` target, which
            # a `for`/`switch`/`select` records; any other wrapped statement
            # is built normally rather than collapsed. `goto` targets
            # aren't modeled.
            return _build_stmt(
                builder, wrapped, breakable_stack, same_file_functions, _text(label_node)
            )
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if stmt.type == "return_statement":
        return _add_stmt_node(builder, FlowNodeKind.RETURN, stmt), []

    if stmt.type in ("break_statement", "continue_statement"):
        is_break = stmt.type == "break_statement"
        label_node = next((c for c in stmt.named_children if c.type == "label_name"), None)
        target_label = _text(label_node)
        keyword = "break" if is_break else "continue"
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT,
            f"{keyword} {target_label}" if target_label else keyword,
            _line(stmt),
            _end_line(stmt),
        )
        ctx = _find_breakable(breakable_stack, target_label, require_loop=not is_break)
        if is_break:
            if ctx is not None:
                ctx.pending_breaks.append((node_id, FlowEdgeKind.FLOW, None))
        elif ctx is not None and ctx.header is not None:
            builder.add_edge(node_id, ctx.header, FlowEdgeKind.LOOP_BACK)
        return node_id, []

    if stmt.type == "expression_statement" and stmt.named_children:
        expr = stmt.named_children[0]
        if expr.type == "call_expression":
            return _call_stmt(builder, stmt, expr, same_file_functions)

    if stmt.type in ("go_statement", "defer_statement"):
        call = next((c for c in stmt.named_children if c.type == "call_expression"), None)
        if call is not None:
            return _call_stmt(builder, stmt, call, same_file_functions)

    if stmt.type == "block":
        # A bare `{ ... }` has no branching semantics of its own: flatten it.
        first, pending = _build_block(
            builder, _statements(stmt), breakable_stack, same_file_functions
        )
        if first is not None:
            return first, pending
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "{}", _line(stmt), _end_line(stmt))
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    # Every other statement (declarations, assignments, `goto`, ...) is one
    # opaque node.
    node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def build_go_flowchart(
    builder: Builder, def_node: TSNode, same_file_functions: dict[str, str]
) -> tuple[str, list[PendingExit]]:
    """Builds the flowchart body for a Go function/method's `def_node` (as
    located by `go_locate.locate`) into `builder`. Returns `(body_first,
    pending_exits)`, the contract every `_build_*` helper here uses."""
    body = def_node.child_by_field_name("body")

    if body is None:
        # An external (assembly-backed) function declaration has no body.
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(no body)", _line(def_node), _end_line(def_node)
        )
        return node_id, []

    first, pending = _build_block(builder, _statements(body), [], same_file_functions)
    if first is None:
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(empty body)", _line(body), _end_line(body)
        )
        return node_id, []
    return first, pending
