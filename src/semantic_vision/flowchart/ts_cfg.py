"""JS/TS control-flow representation -- the tree-sitter analogue of
`flowchart/cfg.py`'s per-function CFG builder. Ported per the
spike-first plan in `docs/JS-TS-FLOWCHART-PLAN.md`; every node shape and
field name referenced below was confirmed against live tree-sitter
output before being relied on here, not assumed from the grammar's own
documentation -- the same discipline every other JS/TS module in this
project has used.

Reuses `flowchart.model`'s language-neutral `FlowNode`/`FlowEdge`/
`Builder`/`PendingExit`/`LoopCtx` machinery directly -- nothing here
duplicates that bookkeeping, only the JS/TS-specific statement-walking
logic is new.

Four shapes needed real, dedicated design (the ones the plan called out
as having no direct precedent elsewhere in this codebase to adapt from):

- `switch` fallthrough: an empty `case` (no statements before the next
  `case`) produces no node of its own -- the enclosing `switch`'s
  decision edge for it is resolved forward to whatever the next
  non-empty case starts with, and a non-empty case with no terminal
  `break`/`return`/`throw`/`continue` has its own fall-through pending
  exits wired into the next case's start the same way. This is what
  actually represents fallthrough as multiple entry points converging on
  shared execution, not a single mutually-exclusive `if`/`elif` chain.
- `do...while`'s bottom-condition back-edge: unlike every other loop
  shape here (condition checked *before* the body, so the loop header
  node is both the entry point and the back-edge target), a `do...while`
  runs its body unconditionally first and checks the condition
  afterward -- so the statement's own "entry" (what the enclosing block
  connects to) is the body's first node, not the condition node, and
  `continue` inside the body targets the condition check, not the body
  start.
- Labeled `break`/`continue`: JS/TS `break`/`continue` can target any
  enclosing labeled loop by name, not just the nearest one -- modeled
  via a `label` on each `LoopCtx` pushed for a labeled loop, searched by
  label (falling back to the nearest entry for an unlabeled
  break/continue). `break` (unlabeled or labeled) can also target an
  enclosing `switch`, not just a loop -- `continue` never can, which is
  why `LoopCtx.kind` distinguishes the two: `_find_breakable` only
  considers `kind == "loop"` entries for `continue`.
- The I/O-call vocabulary: a curated, explicitly incomplete list
  (`_IO_BARE_NAMES`/`_IO_METHOD_NAMES`), the same honesty-about-
  completeness `languages/javascript.py`'s `JS_GLOBAL_NAMES` already
  commits to for this project's JS/TS support.

`try`/`catch`/`finally` is deliberately NOT given real branching
representation, even though it's structurally simpler than `switch` --
matching `flowchart/cfg.py`'s own precedent of treating Python's
`try`/`except` as a single opaque statement node rather than "partially
and incorrectly" modeling exception flow (a `finally` block's own
always-runs-regardless semantics, and a `catch` handling only some
exceptions, are real complexity a flattened representation would
misrepresent). A labeled non-loop statement (a labeled block used only
for `break label;`, distinct from a labeled loop) gets the same
fallback, for the same reason -- it's a third breakable-context shape
this project has no precedent for and no immediate need to build.
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
from semantic_vision.parser.javascript_extractor import _dotted_name, _end_line, _line, _text

TSNode = tree_sitter.Node

end_line = _end_line
"""Re-exported so `flowchart/cfg.py` doesn't need its own import of
`javascript_extractor`'s private helper for the one call site it needs
this at (computing the implicit-return node's line when a JS/TS
function's body has unterminated fall-through)."""

_IO_BARE_NAMES = frozenset({"fetch", "alert", "prompt", "confirm"})
_IO_METHOD_NAMES = frozenset(
    {
        # console.*
        "log",
        "error",
        "warn",
        "info",
        "debug",
        "trace",
        # fs.*, process.stdout.write/process.stderr.write, stream.write
        "write",
        "writeSync",
        "readFile",
        "readFileSync",
        "writeFile",
        "writeFileSync",
        # localStorage.*/sessionStorage.*
        "getItem",
        "setItem",
        "removeItem",
    }
)

_LOOP_STMT_TYPES = frozenset(
    {"for_statement", "for_in_statement", "while_statement", "do_statement"}
)


def _classify_call(
    callee: TSNode, dotted: str | None, same_file_functions: dict[str, str]
) -> FlowNodeKind:
    """Both checks below are name-only, not receiver-aware -- the same
    accepted heuristic risk `flowchart.cfg._classify_call` already
    documents for Python: `obj.log()` on some arbitrary non-console
    object is classified `IO` purely because the trailing method name
    matches, and `obj.helper()` resolves to CALL against an unrelated
    same-named top-level function/method if the name happens to be
    unambiguous file-wide, regardless of what `obj` actually is. A real
    false-positive risk, not just under-coverage -- real type inference
    is out of scope here."""
    if dotted is None:
        return FlowNodeKind.STATEMENT
    if callee.type == "identifier" and dotted in _IO_BARE_NAMES:
        return FlowNodeKind.IO
    trailing = dotted.rsplit(".", 1)[-1]
    if callee.type == "member_expression" and trailing in _IO_METHOD_NAMES:
        return FlowNodeKind.IO
    if trailing in same_file_functions:
        return FlowNodeKind.CALL
    return FlowNodeKind.STATEMENT


def _stmt_list(node: TSNode) -> list[TSNode]:
    """The statements inside a body node -- a real `{}` block's own
    statement children, or the single bare statement itself when JS's
    optional-braces form is used (`if (a) x();`). `named_children`
    already excludes punctuation tokens (`{`/`}`) -- confirmed live, not
    assumed."""
    if node.type == "statement_block":
        return list(node.named_children)
    return [node]


def _header_text(stmt: TSNode, body: TSNode) -> str:
    """The statement's own source text up to (not including) its body --
    e.g. `for (let i = 0; i < 10; i++)` without the trailing `{ ... }`.
    Works for any shape where `body` is the *last* field (for/for-in/
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
        # `else_clause` wraps either a nested `if_statement` (an "else
        # if" chain) or the real else-body, as its last child -- no
        # named field on `else_clause` itself for this, confirmed live.
        else_body = alternative.children[-1]
        false_first, false_pending = _build_block(
            builder, _stmt_list(else_body), breakable_stack, same_file_functions
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
    """`for`/`for...in`/`for...of`/`while` -- condition checked before
    the body, same shape as Python's `for`/`while`: the header node is
    both the entry point and the back-edge target."""
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
    """`do...while` -- the one loop shape with no Python equivalent at
    all: the body runs unconditionally first, and the condition is
    checked *after* it, not before. The statement's own entry point (what
    the enclosing block connects its previous statement's edge to) is
    therefore the body's first node, not the condition node -- and
    `continue` inside the body targets the condition check, which this
    function pre-allocates before building the body so it can be used as
    that inner loop context's `header`."""
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

    # The body's own natural fall-through (no terminal break/return/
    # throw/continue) reaches the condition check -- `continue` reaches
    # it too, already wired via `inner_ctx.header = condition_id` inside
    # `_build_stmt`'s continue handling.
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
    discriminant = stmt.child_by_field_name("value")
    decision_id = builder.add_node(
        FlowNodeKind.DECISION, f"switch {_text(discriminant)}", _line(stmt), _end_line(stmt)
    )

    body = stmt.child_by_field_name("body")
    cases = [c for c in body.named_children if c.type in ("switch_case", "switch_default")]

    switch_ctx = LoopCtx(header=None, kind="switch")
    breakable_stack.append(switch_ctx)

    # First pass: build every case's own block (empty cases produce no
    # node of their own -- `first`/`pending` stay `None`/`[]`).
    built: list[tuple[TSNode, str | None, list[PendingExit]]] = []
    for case in cases:
        stmts = case.named_children[1:] if case.type == "switch_case" else case.named_children
        if stmts:
            first, pending = _build_block(builder, stmts, breakable_stack, same_file_functions)
        else:
            first, pending = None, []
        built.append((case, first, pending))

    breakable_stack.pop()

    # Resolve each case's *effective* first node -- an empty case has
    # none of its own, so both the decision edge for it and any prior
    # case's fallthrough into it must skip forward to the next case that
    # actually has one.
    effective_first: list[str | None] = [None] * len(built)
    next_real: str | None = None
    for i in range(len(built) - 1, -1, -1):
        first = built[i][1]
        effective_first[i] = first if first is not None else next_real
        if first is not None:
            next_real = first

    switch_exits: list[PendingExit] = list(switch_ctx.pending_breaks)
    has_default = any(case.type == "switch_default" for case in cases)

    for i, (case, _first, pending) in enumerate(built):
        target = effective_first[i]
        if target is not None:
            edge_label = "default" if case.type == "switch_default" else _text(
                case.child_by_field_name("value")
            )
            builder.add_edge(decision_id, target, FlowEdgeKind.FLOW, edge_label)

        if i + 1 < len(built):
            next_target = effective_first[i + 1]
            if pending and next_target is not None:
                builder.connect(pending, next_target)
            elif pending:
                # Fell through past every remaining case with no real
                # node to land on (a trailing run of empty cases) -- the
                # switch itself, not exiting.
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

    if stmt.type in ("for_statement", "for_in_statement", "while_statement"):
        return _build_regular_loop(builder, stmt, breakable_stack, same_file_functions, label)

    if stmt.type == "do_statement":
        return _build_do_while(builder, stmt, breakable_stack, same_file_functions, label)

    if stmt.type == "switch_statement":
        return _build_switch(builder, stmt, breakable_stack, same_file_functions)

    if stmt.type == "labeled_statement":
        label_node = stmt.child_by_field_name("label")
        wrapped = stmt.child_by_field_name("body")
        if label_node is not None and wrapped is not None and wrapped.type in _LOOP_STMT_TYPES:
            return _build_stmt(
                builder, wrapped, breakable_stack, same_file_functions, _text(label_node)
            )
        # A labeled non-loop statement (e.g. a labeled block used only
        # for `break label;`) isn't specially modeled -- see module
        # docstring.
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
        label_node = stmt.child_by_field_name("label")
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
        label_node = stmt.child_by_field_name("label")
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
        if expr.type == "call_expression":
            callee = expr.child_by_field_name("function")
            kind = FlowNodeKind.STATEMENT
            if callee is not None:
                kind = _classify_call(callee, _dotted_name(callee), same_file_functions)
            node_id = _add_stmt_node(builder, kind, stmt)
            return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    if stmt.type == "statement_block":
        # A bare `{ ... }` block statement -- unlike `try`/`catch`, this
        # has no branching/exception semantics of its own (it only
        # scopes `let`/`const`), so flattening it into the enclosing
        # flow is exactly correct, not a simplification. Without this,
        # a braced `switch` case body (`case 1: { let x = 1; f(); break; }`
        # -- the pattern TS/ESLint's `no-case-declarations` rule actively
        # pushes developers toward) fell through to the opaque-statement
        # case below, silently erasing its internal `break`/`return`/
        # branching from the graph and misrepresenting it as falling
        # through into the next case. Same fix covers a bare block
        # anywhere else in a function body, not just inside `switch`.
        first, pending = _build_block(
            builder, list(stmt.named_children), breakable_stack, same_file_functions
        )
        if first is not None:
            return first, pending
        # An empty block (`{}`) -- nothing to flatten.
        node_id = builder.add_node(FlowNodeKind.STATEMENT, "{}", _line(stmt), _end_line(stmt))
        return node_id, [(node_id, FlowEdgeKind.FLOW, None)]

    # Every other statement kind (variable declarations, `try`/`catch`,
    # nested function/class defs, etc.) becomes one opaque node rather
    # than being descended into or partially modeled -- see module
    # docstring for `try`/`catch`/`finally` specifically.
    node_id = _add_stmt_node(builder, FlowNodeKind.STATEMENT, stmt)
    return node_id, [(node_id, FlowEdgeKind.FLOW, None)]


def build_ts_flowchart(
    builder: Builder, def_node: TSNode, same_file_functions: dict[str, str]
) -> tuple[str, list[PendingExit]]:
    """Builds the flowchart body for a JS/TS function/method/arrow's
    `def_node` (as located by `ts_locate.locate`) into `builder`,
    mirroring `flowchart.cfg`'s own top-level `_build_block` call for a
    Python function body. Returns `(body_first, pending_exits)`, the same
    contract every `_build_*` helper here uses."""
    body = def_node.child_by_field_name("body")

    if body is None:
        # An ambient/overload declaration with no implementation (`function
        # foo(): void;`) -- rare, and there's nothing to walk.
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(no body)", _line(def_node), _end_line(def_node)
        )
        return node_id, []

    if body.type != "statement_block":
        # A concise-body arrow function (`x => x + 1`, no braces) -- the
        # expression itself is the implicit return value.
        node_id = builder.add_node(
            FlowNodeKind.RETURN, _text(body) or "", _line(body), _end_line(body)
        )
        return node_id, []

    first, pending = _build_block(builder, list(body.named_children), [], same_file_functions)
    if first is None:
        # An empty body (`function f() {}`) -- nothing to walk, no exit.
        node_id = builder.add_node(
            FlowNodeKind.STATEMENT, "(empty body)", _line(body), _end_line(body)
        )
        return node_id, []
    return first, pending
