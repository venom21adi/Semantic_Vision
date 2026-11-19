"""C# control-flow representation -- the tree-sitter analogue of
`flowchart/java_cfg.py`, for a C# method / constructor / accessor body.

Reuses `flowchart.model`'s language-neutral `Builder` / `PendingExit` /
`LoopCtx` machinery directly. Where C# differs from Java, and how it is handled:

- Bodies may be a bare statement (`if (x) return;`), not only a block, so
  `_stmt_list` accepts either.
- `foreach` is its own node type, alongside `for`/`while`; all three are the
  same "condition before body" shape.
- A `switch` section carries its labels inline (`case 1:`, `case Foo f when ...:`,
  `default:`) rather than in a wrapper node, so the label text is recovered by
  slicing the section up to its first statement. The fallthrough-forwarding
  algorithm is the one `java_cfg._build_switch` already uses.
- `using`, `lock`, `checked`, `unsafe` and `fixed` blocks have no branching of
  their own: they become a header node with the body flowing straight on.
- `try`/`catch`/`finally` stays one opaque statement, the same "do not partially
  model exception flow" precedent Java and JS follow here.
- Expression-bodied members (`int F() => x * 2;`) and expression-bodied
  properties become a single node.
- `switch` *expressions* and lambdas are expressions, not statements, and stay
  inside whatever statement contains them.
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
from semantic_vision.parser.csharp_extractor import _end_line, _line, _text

TSNode = tree_sitter.Node

end_line = _end_line
"""Re-exported so `flowchart/cfg.py` needs no import of the extractor's private helper."""

_IO_METHOD_NAMES = frozenset(
    {
        # Console / TextWriter / TextReader / Stream
        "WriteLine", "Write", "ReadLine", "Read", "ReadKey", "Flush", "Close", "Dispose",
        # System.IO.File / Directory / StreamReader helpers
        "ReadAllText", "WriteAllText", "ReadAllLines", "WriteAllLines", "ReadAllBytes",
        "WriteAllBytes", "AppendAllText", "OpenRead", "OpenWrite", "CopyTo",
        # async counterparts
        "WriteAsync", "WriteLineAsync", "ReadAsync", "ReadLineAsync", "ReadToEndAsync",
        "FlushAsync", "CopyToAsync", "ReadAllTextAsync", "WriteAllTextAsync",
    }
)  # fmt: skip
_REGULAR_LOOP_TYPES = frozenset({"for_statement", "foreach_statement", "while_statement"})
_WRAPPER_STATEMENT_TYPES = frozenset(
    {
        "using_statement",
        "lock_statement",
        "checked_statement",
        "unsafe_statement",
        "fixed_statement",
    }
)


def _call_name(invocation: TSNode) -> tuple[str, bool]:
    """(`method name`, `has a receiver`) of an `invocation_expression`."""
    fn = invocation.child_by_field_name("function")
    if fn is None:
        return "", False
    if fn.type == "member_access_expression":
        name = fn.child_by_field_name("name")
        return _text(
            name.named_children[0]
            if name is not None and name.type == "generic_name" and name.named_children
            else name
        ), True
    if fn.type in ("identifier", "generic_name"):
        ident = fn.named_children[0] if fn.type == "generic_name" and fn.named_children else fn
        return _text(ident), False
    return "", False


def _classify_call(
    name: str, has_receiver: bool, same_file_functions: dict[str, str]
) -> FlowNodeKind:
    """Name-only, not receiver-aware -- the same accepted heuristic the other
    languages document: `obj.Write(...)` is `IO` because of the method name alone."""
    if not name:
        return FlowNodeKind.STATEMENT
    if has_receiver and name in _IO_METHOD_NAMES:
        return FlowNodeKind.IO
    if name in same_file_functions:
        return FlowNodeKind.CALL
    return FlowNodeKind.STATEMENT


def _stmt_list(node: TSNode) -> list[TSNode]:
    """A body's statements: a block's children, or the single bare statement."""
    if node.type == "block":
        return list(node.named_children)
    return [node]


def _header_text(stmt: TSNode, body: TSNode) -> str:
    """The statement's source up to (not including) its body, e.g.
    `foreach (var x in xs)` without the `{ ... }`."""
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


def _empty_body(builder: Builder, node: TSNode) -> tuple[str, list[PendingExit]]:
    node_id = builder.add_node(FlowNodeKind.STATEMENT, "{}", _line(node), _end_line(node))
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def _build_body(
    builder: Builder, body: TSNode, breakable_stack: list[LoopCtx], same: dict[str, str]
) -> tuple[str, list[PendingExit]]:
    """A construct's body as one entry plus its pending exits; an empty body
    still yields a node so the construct has something to connect to."""
    first, pending = _build_block(builder, _stmt_list(body), breakable_stack, same)
    if first is None:
        return _empty_body(builder, body)
    return first, pending


def _build_if(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    condition = stmt.child_by_field_name("condition")
    decision_id = builder.add_node(
        FlowNodeKind.DECISION, f"if {_text(condition)}", _line(stmt), _end_line(stmt)
    )
    consequence = stmt.child_by_field_name("consequence")
    true_first, true_pending = _build_body(
        builder, consequence, breakable_stack, same_file_functions
    )
    builder.add_edge(decision_id, true_first, FlowEdgeKind.TRUE, "Yes")

    alternative = stmt.child_by_field_name("alternative")
    if alternative is not None:
        false_first, false_pending = _build_body(
            builder, alternative, breakable_stack, same_file_functions
        )
        builder.add_edge(decision_id, false_first, FlowEdgeKind.FALSE, "No")
        pending = true_pending + false_pending
    else:
        pending = [*true_pending, (decision_id, FlowEdgeKind.FALSE, "No")]
    return decision_id, pending


def _build_regular_loop(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None,
) -> tuple[str, list[PendingExit]]:
    """`for` / `foreach` / `while`: the condition is checked before the body, so the
    header node is both the entry point and the back-edge target."""
    body = stmt.child_by_field_name("body")
    header_id = builder.add_node(
        FlowNodeKind.LOOP, _header_text(stmt, body), _line(stmt), _end_line(stmt)
    )
    inner_ctx = LoopCtx(header=header_id, label=label)
    breakable_stack.append(inner_ctx)
    body_first, body_pending = _build_body(builder, body, breakable_stack, same_file_functions)
    breakable_stack.pop()

    builder.add_edge(header_id, body_first, FlowEdgeKind.FLOW, "Loop")
    for source, _kind, _label in body_pending:
        builder.add_edge(source, header_id, FlowEdgeKind.LOOP_BACK)
    exits = [(header_id, FlowEdgeKind.FLOW, "Done"), *inner_ctx.pending_breaks]
    return header_id, exits


def _build_do_while(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None,
) -> tuple[str, list[PendingExit]]:
    """`do { } while (cond)`: the body runs first and the condition is checked after
    it, so the statement's entry is the body's first node and `continue` targets the
    condition (allocated before the body so it can be the context's header)."""
    condition = stmt.child_by_field_name("condition")
    condition_id = builder.add_node(
        FlowNodeKind.LOOP, f"do...while {_text(condition)}", _line(stmt), _end_line(stmt)
    )
    body = stmt.child_by_field_name("body")
    inner_ctx = LoopCtx(header=condition_id, label=label)
    breakable_stack.append(inner_ctx)
    body_first, body_pending = _build_body(builder, body, breakable_stack, same_file_functions)
    breakable_stack.pop()

    builder.connect(body_pending, condition_id)
    builder.add_edge(condition_id, body_first, FlowEdgeKind.LOOP_BACK)
    exits = [(condition_id, FlowEdgeKind.FLOW, "Done"), *inner_ctx.pending_breaks]
    return body_first, exits


_STATEMENT_SUFFIX = "_statement"


def _is_statement(node: TSNode) -> bool:
    return node.type == "block" or node.type.endswith(_STATEMENT_SUFFIX)


def _split_section(section: TSNode) -> tuple[bool, str, list[TSNode]]:
    """(`is_default`, `case label text`, `statements`) of a `switch_section`."""
    statements = [c for c in section.named_children if _is_statement(c)]
    is_default = any(c.type == "default" for c in section.children[:2])
    end = statements[0].start_byte if statements else section.end_byte
    label = section.text[: end - section.start_byte].decode("utf-8").strip().rstrip(":").strip()
    if label.startswith("case "):
        label = label[len("case ") :].strip()
    return is_default, label, statements


def _build_switch(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    body = stmt.child_by_field_name("body")
    sections = [
        c for c in (body.named_children if body is not None else []) if c.type == "switch_section"
    ]
    value = stmt.child_by_field_name("value")
    decision_id = builder.add_node(
        FlowNodeKind.DECISION, f"switch {_text(value)}", _line(stmt), _end_line(stmt)
    )
    switch_ctx = LoopCtx(header=None, kind="switch")
    breakable_stack.append(switch_ctx)

    built: list[tuple[bool, str, str | None, list[PendingExit]]] = []
    for section in sections:
        is_default, label, stmts = _split_section(section)
        if stmts:
            first, pending = _build_block(builder, stmts, breakable_stack, same_file_functions)
        else:
            first, pending = None, []
        built.append((is_default, label, first, pending))
    breakable_stack.pop()

    # An empty section (`case 1:` directly above `case 2:`) has no node of its own:
    # both the decision edge to it and any earlier fallthrough into it skip forward
    # to the next section that does. Same algorithm as `java_cfg._build_switch`.
    effective_first: list[str | None] = [None] * len(built)
    next_real: str | None = None
    for i in range(len(built) - 1, -1, -1):
        first = built[i][2]
        effective_first[i] = first if first is not None else next_real
        if first is not None:
            next_real = first

    switch_exits: list[PendingExit] = list(switch_ctx.pending_breaks)
    has_default = any(is_default for is_default, *_ in built)
    for i, (is_default, label, _first, pending) in enumerate(built):
        target = effective_first[i]
        if target is not None:
            builder.add_edge(
                decision_id, target, FlowEdgeKind.FLOW, "default" if is_default else label
            )
        if i + 1 < len(built):
            next_target = effective_first[i + 1]
            if pending and next_target is not None:
                builder.connect(pending, next_target)
            elif pending:
                switch_exits.extend(pending)
        else:
            switch_exits.extend(pending)
    if not has_default:
        switch_exits.append((decision_id, FlowEdgeKind.FLOW, "no match"))
    return decision_id, switch_exits


def _build_wrapper(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    """`using` / `lock` / `checked` / ...: a header node, then the body flowing on."""
    body = stmt.child_by_field_name("body") or next(
        (c for c in reversed(stmt.named_children) if _is_statement(c)), None
    )
    if body is None:
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]
    header_id = builder.add_node(
        FlowNodeKind.STATEMENT, _header_text(stmt, body), _line(stmt), _end_line(stmt)
    )
    first, pending = _build_block(builder, _stmt_list(body), breakable_stack, same_file_functions)
    if first is None:
        return header_id, [(header_id, FlowEdgeKind.FLOW, None)]
    builder.add_edge(header_id, first)
    return header_id, pending


def _jump_label(stmt: TSNode) -> str | None:
    named = stmt.named_children[0] if stmt.named_children else None
    return _text(named) or None


def _unwrap_call(expr: TSNode) -> TSNode | None:
    """The `invocation_expression` an expression statement boils down to (looking
    through `await`), or None."""
    if expr.type == "await_expression" and expr.named_children:
        expr = expr.named_children[0]
    return expr if expr.type == "invocation_expression" else None


def _build_stmt(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None = None,
) -> tuple[str, list[PendingExit]]:
    t = stmt.type
    if t == "if_statement":
        return _build_if(builder, stmt, breakable_stack, same_file_functions)
    if t in _REGULAR_LOOP_TYPES:
        return _build_regular_loop(builder, stmt, breakable_stack, same_file_functions, label)
    if t == "do_statement":
        return _build_do_while(builder, stmt, breakable_stack, same_file_functions, label)
    if t == "switch_statement":
        return _build_switch(builder, stmt, breakable_stack, same_file_functions)
    if t in _WRAPPER_STATEMENT_TYPES:
        return _build_wrapper(builder, stmt, breakable_stack, same_file_functions)

    if t == "labeled_statement":
        label_node = stmt.named_children[0] if stmt.named_children else None
        wrapped = stmt.named_children[1] if len(stmt.named_children) > 1 else None
        if wrapped is not None and (
            wrapped.type in _REGULAR_LOOP_TYPES or wrapped.type == "do_statement"
        ):
            return _build_stmt(
                builder, wrapped, breakable_stack, same_file_functions, _text(label_node)
            )
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if t == "return_statement":
        return _add_stmt_node(builder, FlowNodeKind.RETURN, stmt), []
    if t == "throw_statement":
        # Terminal: code after `throw` is unreachable, no exit is drawn.
        return _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt), []
    if t == "yield_statement":
        is_break = any(c.type == "break" for c in stmt.children)
        if is_break:
            return _add_stmt_node(builder, FlowNodeKind.RETURN, stmt), []
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if t == "break_statement":
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "break", _line(stmt), _end_line(stmt))
        ctx = _find_breakable(breakable_stack, None, require_loop=False)
        if ctx is not None:
            ctx.pending_breaks.append((node_id, FlowEdgeKind.FLOW, None))
        return node_id, []
    if t == "continue_statement":
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "continue", _line(stmt), _end_line(stmt))
        ctx = _find_breakable(breakable_stack, None, require_loop=True)
        if ctx is not None and ctx.header is not None:
            builder.add_edge(node_id, ctx.header, FlowEdgeKind.LOOP_BACK)
        return node_id, []
    if t == "goto_statement":
        # An unstructured jump cannot be drawn faithfully; treat it as terminal.
        return _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt), []

    if t == "expression_statement" and stmt.named_children:
        call = _unwrap_call(stmt.named_children[0])
        if call is not None:
            name, has_receiver = _call_name(call)
            kind = _classify_call(name, has_receiver, same_file_functions)
            node_id = _add_stmt_node(builder, kind, stmt)
            return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if t == "block":
        first, pending = _build_block(
            builder, list(stmt.named_children), breakable_stack, same_file_functions
        )
        if first is not None:
            return first, pending
        return _empty_body(builder, stmt)

    # Every other statement (declarations, `try`/`catch`/`finally`, local functions,
    # plain expressions) is one opaque node rather than being descended into.
    node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def build_csharp_flowchart(
    builder: Builder, def_node: TSNode, same_file_functions: dict[str, str]
) -> tuple[str, list[PendingExit]]:
    """The flowchart body for a C# def node (as located by `csharp_locate.locate`).
    Returns `(body_first, pending_exits)`, the contract every `_build_*` helper uses."""
    body = def_node.child_by_field_name("body")
    if body is None:
        body = next((c for c in def_node.children if c.type == "arrow_expression_clause"), None)

    if body is None:
        # abstract / interface / extern member, or an auto-property: nothing to walk
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(no body)", _line(def_node), _end_line(def_node)
        )
        return node_id, []

    if body.type == "arrow_expression_clause":
        # `=> expr`: one node (a value-returning member's expression is its result)
        expr = body.named_children[0] if body.named_children else body
        call = _unwrap_call(expr)
        kind = FlowNodeKind.STATEMENT
        if call is not None:
            name, has_receiver = _call_name(call)
            kind = _classify_call(name, has_receiver, same_file_functions)
        node_id = builder.add_node(kind, _text(expr), _line(body), _end_line(body))
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    first, pending = _build_block(builder, list(body.named_children), [], same_file_functions)
    if first is None:
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(empty body)", _line(body), _end_line(body)
        )
        return node_id, []
    return first, pending
