"""Java control-flow representation -- the tree-sitter analogue of
`flowchart/ts_cfg.py`, for a Java method/constructor body. Every node
shape and field name referenced below was confirmed against live
tree-sitter-java output before being relied on here, the same discipline
`ts_cfg.py`/`java_extractor.py` already document for their own grammars.

Reuses `flowchart.model`'s language-neutral `FlowNode`/`FlowEdge`/
`Builder`/`PendingExit`/`LoopCtx` machinery directly, same as `ts_cfg.py`.

Structurally simpler than `ts_cfg.py` in a few confirmed ways:

- `if_statement`'s `alternative` field is directly another `if_statement`
  (an else-if chain) or the plain else-body statement -- no intermediate
  `else_clause` wrapper to unwrap, unlike JS.
- `try_statement` exposes only a `body` field (no field for its
  `catch_clause`/`finally_clause` children), so it already falls through
  the shared opaque-statement fallback below with no dedicated handling
  needed -- matching this project's existing `try`/`except`/`try`/`catch`
  precedent of not partially modeling exception flow.
- Annotations (`@Override`, etc.) live inside a `modifiers` node that is
  an ordinary child of the declaration itself, never split across a
  wrapping node the way a JS decorator sometimes is -- so flowchart
  entry-label rendering (`ai.context._render_java_signature`) needs no
  span-adjustment dance.

One shape needed real, dedicated design, with no direct precedent even in
`ts_cfg.py`: Java has two distinct "regular" loop node types
(`for_statement` and `enhanced_for_statement`, i.e. for-each) where JS
collapses both `for...in`/`for...of` into one `for_in_statement` -- both
are treated as the same "condition before body" shape here, just
dispatched from two type names instead of one.

Java's `switch_expression` node (the one node type for both switch-
statement and switch-expression use in this grammar) reuses the exact
"effective first node" fallthrough-forwarding algorithm `ts_cfg.py`'s own
`_build_switch` already worked out, just over `switch_block_statement_group`
children instead of `switch_case`/`switch_default`. Modern arrow-style
`case X -> ...` (`switch_rule` groups, Java 14+) is out of scope, same
"don't partially/incorrectly model" reasoning as `try`/`catch` --
detected and treated as one opaque statement instead.
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
from semantic_vision.parser.java_extractor import _dotted_name, _end_line, _line, _text

TSNode = tree_sitter.Node

end_line = _end_line
"""Re-exported so `flowchart/cfg.py` doesn't need its own import of
`java_extractor`'s private helper for the one call site it needs this at
(computing the implicit-return node's line when a Java method's body has
unterminated fall-through)."""

_IO_METHOD_NAMES = frozenset(
    {
        # System.out.*/System.err.*, PrintStream/PrintWriter
        "println",
        "print",
        "printf",
        # Writer/OutputStream/Reader/InputStream
        "write",
        "read",
        "readLine",
        "close",
        "flush",
        # Scanner
        "nextLine",
        "next",
        "nextInt",
    }
)

_REGULAR_LOOP_TYPES = frozenset({"for_statement", "enhanced_for_statement", "while_statement"})


def _classify_call(
    callee: TSNode, dotted: str | None, same_file_functions: dict[str, str]
) -> FlowNodeKind:
    """Name-only, not receiver-aware -- the same accepted heuristic risk
    `ts_cfg._classify_call`/`flowchart.cfg._classify_call` already
    document: `obj.write(...)` is classified `IO` purely because the
    trailing method name matches, regardless of what `obj` actually is."""
    if dotted is None:
        return FlowNodeKind.STATEMENT
    trailing = dotted.rsplit(".", 1)[-1]
    if callee.type == "field_access" and trailing in _IO_METHOD_NAMES:
        return FlowNodeKind.IO
    if trailing in same_file_functions:
        return FlowNodeKind.CALL
    return FlowNodeKind.STATEMENT


def _stmt_list(node: TSNode) -> list[TSNode]:
    """The statements inside a body node -- a real `{}` block's own
    statement children. Unlike JS, Java's grammar always requires braces
    for an `if`/`for`/`while`/`do` body (no optional-braces single-
    statement form), so `node` is always a `block` in practice here --
    kept as a helper (mirroring `ts_cfg._stmt_list`'s shape) purely so a
    non-`block` alternative (only reachable via `if_statement`'s
    `alternative` field pointing at a bare nested `if_statement` for an
    else-if chain) still resolves to a one-element list."""
    if node.type == "block":
        return list(node.named_children)
    return [node]


def _header_text(stmt: TSNode, body: TSNode) -> str:
    """The statement's own source text up to (not including) its body --
    e.g. `for (int i = 0; i < 10; i++)` without the trailing `{ ... }`.
    Works for any shape where `body` is the last field (for/enhanced-for/
    while) -- `do...while` builds its own label separately, since its
    body comes first."""
    header_bytes = stmt.text[: body.start_byte - stmt.start_byte]
    return header_bytes.decode("utf-8").strip()


def _add_stmt_node(builder: Builder, kind: FlowNodeKind, stmt: TSNode) -> str:
    return builder.add_node(kind, _text(stmt) or stmt.type, _line(stmt), _end_line(stmt))


def _find_breakable(
    stack: list[LoopCtx], label: str | None, *, require_loop: bool
) -> LoopCtx | None:
    candidates = reversed(stack)
    if label is None:
        for ctx in candidates:
            if not require_loop or ctx.kind == "loop":
                return ctx
        return None
    for ctx in candidates:
        if ctx.label == label and (not require_loop or ctx.kind == "loop"):
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


def _build_if(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    condition = stmt.child_by_field_name("condition")
    label = f"if {_text(condition)}"
    decision_id = builder.add_node(FlowNodeKind.DECISION, label, _line(stmt), _end_line(stmt))

    consequence = stmt.child_by_field_name("consequence")
    true_first, true_pending = _build_block(
        builder, _stmt_list(consequence), breakable_stack, same_file_functions
    )
    assert true_first is not None  # an `if` consequence always has >=1 statement
    builder.add_edge(decision_id, true_first, FlowEdgeKind.TRUE, "Yes")

    alternative = stmt.child_by_field_name("alternative")
    if alternative is not None:
        # Directly another `if_statement` (else-if) or the plain else
        # body -- no `else_clause` wrapper, confirmed live (unlike JS).
        false_first, false_pending = _build_block(
            builder, _stmt_list(alternative), breakable_stack, same_file_functions
        )
        assert false_first is not None
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
    """`for`/`enhanced_for` (for-each)/`while` -- condition checked before
    the body, same shape as Python's `for`/`while`: the header node is
    both the entry point and the back-edge target. `for_statement`'s
    `init`/`condition`/`update` fields are all independently optional
    (`for (;;)` has only `body`), but the header is built from raw source
    text, not the individual fields, so that's transparent here."""
    body = stmt.child_by_field_name("body")
    header_label = _header_text(stmt, body)
    header_id = builder.add_node(FlowNodeKind.LOOP, header_label, _line(stmt), _end_line(stmt))

    inner_ctx = LoopCtx(header=header_id, label=label)
    breakable_stack.append(inner_ctx)
    body_first, body_pending = _build_block(
        builder, _stmt_list(body), breakable_stack, same_file_functions
    )
    breakable_stack.pop()
    assert body_first is not None  # a loop body always has >=1 statement

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
    """`do...while` -- the body runs unconditionally first, and the
    condition is checked *after* it. The statement's own entry point is
    therefore the body's first node, not the condition node -- and
    `continue` inside the body targets the condition check, pre-allocated
    before building the body so it can be used as the inner loop
    context's `header`. Mirrors `ts_cfg._build_do_while` exactly; only
    field names differ (`body` comes before `condition` here)."""
    condition = stmt.child_by_field_name("condition")
    condition_label = f"do...while {_text(condition)}"
    condition_id = builder.add_node(
        FlowNodeKind.LOOP, condition_label, _line(stmt), _end_line(stmt)
    )

    body = stmt.child_by_field_name("body")
    inner_ctx = LoopCtx(header=condition_id, label=label)
    breakable_stack.append(inner_ctx)
    body_first, body_pending = _build_block(
        builder, _stmt_list(body), breakable_stack, same_file_functions
    )
    breakable_stack.pop()
    assert body_first is not None  # a do...while body always has >=1 statement

    builder.connect(body_pending, condition_id)
    builder.add_edge(condition_id, body_first, FlowEdgeKind.LOOP_BACK)

    exits = [(condition_id, FlowEdgeKind.FLOW, "Done"), *inner_ctx.pending_breaks]
    return body_first, exits


def _build_switch(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
) -> tuple[str, list[PendingExit]]:
    body = stmt.child_by_field_name("body")
    groups = [c for c in body.named_children if c.type == "switch_block_statement_group"]
    has_arrow_case = any(c.type == "switch_rule" for c in body.named_children)

    discriminant = stmt.child_by_field_name("condition")
    if has_arrow_case:
        # Modern arrow-style `case X -> ...` -- out of scope (see module
        # docstring), one opaque node rather than partially modeling it.
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    decision_id = builder.add_node(
        FlowNodeKind.DECISION, f"switch {_text(discriminant)}", _line(stmt), _end_line(stmt)
    )

    switch_ctx = LoopCtx(header=None, kind="switch")
    breakable_stack.append(switch_ctx)

    # First pass: build every case's own block (an empty case -- a label
    # immediately followed by the next label -- produces no node of its
    # own: `first`/`pending` stay `None`/`[]`). `is_default` is a literal
    # `default` keyword token as the label's first child (confirmed
    # live); a `case <expr>` label's own last named child is the case
    # value expression.
    built: list[tuple[bool, str | None, str | None, list[PendingExit]]] = []
    for group in groups:
        label_node = group.named_children[0]
        stmts = group.named_children[1:]
        is_default = bool(label_node.children) and label_node.children[0].type == "default"
        case_value = None if is_default else _text(label_node.named_children[-1])
        if stmts:
            first, pending = _build_block(builder, stmts, breakable_stack, same_file_functions)
        else:
            first, pending = None, []
        built.append((is_default, case_value, first, pending))

    breakable_stack.pop()

    # Resolve each case's *effective* first node -- an empty case has
    # none of its own, so both the decision edge for it and any prior
    # case's fallthrough into it must skip forward to the next case that
    # actually has one. Mirrors `ts_cfg._build_switch` exactly.
    effective_first: list[str | None] = [None] * len(built)
    next_real: str | None = None
    for i in range(len(built) - 1, -1, -1):
        first = built[i][2]
        effective_first[i] = first if first is not None else next_real
        if first is not None:
            next_real = first

    switch_exits: list[PendingExit] = list(switch_ctx.pending_breaks)
    has_default = any(is_default for is_default, _value, _first, _pending in built)

    for i, (is_default, case_value, _first, pending) in enumerate(built):
        target = effective_first[i]
        if target is not None:
            edge_label = "default" if is_default else case_value
            builder.add_edge(decision_id, target, FlowEdgeKind.FLOW, edge_label)

        if i + 1 < len(built):
            next_target = effective_first[i + 1]
            if pending and next_target is not None:
                builder.connect(pending, next_target)
            elif pending:
                # Fell through past every remaining case with no real
                # node to land on (a trailing run of empty cases).
                switch_exits.extend(pending)
        else:
            # Last case: its own fall-through (no terminal break) exits
            # the switch entirely.
            switch_exits.extend(pending)

    if not has_default:
        # No case matched -- falls straight through to after the switch.
        switch_exits.append((decision_id, FlowEdgeKind.FLOW, "no match"))

    return decision_id, switch_exits


def _build_stmt(
    builder: Builder,
    stmt: TSNode,
    breakable_stack: list[LoopCtx],
    same_file_functions: dict[str, str],
    label: str | None = None,
) -> tuple[str, list[PendingExit]]:
    if stmt.type == "if_statement":
        return _build_if(builder, stmt, breakable_stack, same_file_functions)

    if stmt.type in _REGULAR_LOOP_TYPES:
        return _build_regular_loop(builder, stmt, breakable_stack, same_file_functions, label)

    if stmt.type == "do_statement":
        return _build_do_while(builder, stmt, breakable_stack, same_file_functions, label)

    if stmt.type == "switch_expression":
        return _build_switch(builder, stmt, breakable_stack, same_file_functions)

    if stmt.type == "labeled_statement":
        # No named fields at all, confirmed live -- the label identifier
        # and the wrapped statement are plain positional named_children.
        label_node = stmt.named_children[0] if stmt.named_children else None
        wrapped = stmt.named_children[1] if len(stmt.named_children) > 1 else None
        if wrapped is not None and (
            wrapped.type in _REGULAR_LOOP_TYPES or wrapped.type == "do_statement"
        ):
            return _build_stmt(
                builder, wrapped, breakable_stack, same_file_functions, _text(label_node)
            )
        # A labeled non-loop statement (e.g. a labeled block used only
        # for `break label;`) isn't specially modeled -- same fallback
        # `ts_cfg.py` uses for the same shape.
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if stmt.type == "return_statement":
        node_id = _add_stmt_node(builder, FlowNodeKind.RETURN, stmt)
        return node_id, []

    if stmt.type == "throw_statement":
        # Terminal: code after `throw` is unreachable, no exit is drawn.
        node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
        return node_id, []

    if stmt.type == "break_statement":
        label_node = stmt.named_children[0] if stmt.named_children else None
        target_label = _text(label_node)
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT,
            f"break {target_label}" if target_label else "break",
            _line(stmt),
            _end_line(stmt),
        )
        ctx = _find_breakable(breakable_stack, target_label, require_loop=False)
        if ctx is not None:
            ctx.pending_breaks.append((node_id, FlowEdgeKind.FLOW, None))
        return node_id, []

    if stmt.type == "continue_statement":
        label_node = stmt.named_children[0] if stmt.named_children else None
        target_label = _text(label_node)
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT,
            f"continue {target_label}" if target_label else "continue",
            _line(stmt),
            _end_line(stmt),
        )
        ctx = _find_breakable(breakable_stack, target_label, require_loop=True)
        if ctx is not None and ctx.header is not None:
            builder.add_edge(node_id, ctx.header, FlowEdgeKind.LOOP_BACK)
        return node_id, []

    if stmt.type == "expression_statement" and stmt.named_children:
        expr = stmt.named_children[0]
        if expr.type == "method_invocation":
            obj = expr.child_by_field_name("object")
            name_node = expr.child_by_field_name("name")
            name = _text(name_node)
            if obj is not None:
                obj_dotted = _dotted_name(obj)
                dotted = f"{obj_dotted}.{name}" if obj_dotted is not None and name else None
                callee = obj
            else:
                dotted = f"this.{name}" if name else None
                callee = expr
            kind = _classify_call(callee, dotted, same_file_functions)
            node_id = _add_stmt_node(builder, kind, stmt)
            return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if stmt.type == "block":
        # A bare `{ ... }` block statement -- no branching/exception
        # semantics of its own, so flattening it into the enclosing flow
        # is exactly correct, matching `ts_cfg.py`'s identical treatment
        # of a bare `statement_block` (e.g. a braced `switch` case body).
        first, pending = _build_block(
            builder, list(stmt.named_children), breakable_stack, same_file_functions
        )
        if first is not None:
            return first, pending
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "{}", _line(stmt), _end_line(stmt))
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    # Every other statement kind (local variable declarations, `try`/
    # `catch`/`finally`, nested local class declarations, etc.) becomes
    # one opaque node rather than being descended into or partially
    # modeled -- see module docstring for `try`/`catch`/`finally`
    # specifically.
    node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def build_java_flowchart(
    builder: Builder, def_node: TSNode, same_file_functions: dict[str, str]
) -> tuple[str, list[PendingExit]]:
    """Builds the flowchart body for a Java method/constructor's
    `def_node` (as located by `java_locate.locate`) into `builder`,
    mirroring `ts_cfg.build_ts_flowchart`'s/`flowchart.cfg`'s own
    top-level `_build_block` call. Returns `(body_first, pending_exits)`,
    the same contract every `_build_*` helper here uses."""
    body = def_node.child_by_field_name("body")

    if body is None:
        # An abstract method or interface method declaration (`double
        # area();`) has no implementation -- nothing to walk.
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(no body)", _line(def_node), _end_line(def_node)
        )
        return node_id, []

    first, pending = _build_block(builder, list(body.named_children), [], same_file_functions)
    if first is None:
        # An empty body (`void f() {}`) -- nothing to walk, no exit.
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(empty body)", _line(body), _end_line(body)
        )
        return node_id, []
    return first, pending
