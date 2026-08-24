"""Constrained context assembly for AI documentation (Milestone 6 /
TASK-08): given a target function node, gathers its source, exact
signature, direct callee/caller signatures, and parent class header (if
any) into a single prompt, trimmed to an approximate token ceiling.

Kept deliberately separate from `ai.providers` (provider transport) per
the build plan's cross-cutting requirement.
"""

from __future__ import annotations

import ast
import copy
from pathlib import Path

from pydantic import BaseModel

from semantic_vision.ast_locate import DefNode, locate
from semantic_vision.models import EdgeKind, Node, NodeKind, ParseResult

MAX_CONTEXT_TOKENS = 2000


class DocContext(BaseModel):
    node_id: str
    prompt: str
    """Fully assembled context text, ready to send as the user message."""
    omitted: list[str]
    """Section names dropped or truncated to stay within the token budget."""


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _decorator_inclusive_start(def_node: DefNode, fallback_start: int) -> int:
    """`FunctionDef.lineno`/`ClassDef.lineno` (and hence `Node.line_start`,
    which is derived from it) point at the `def`/`class` keyword line, not
    the first decorator -- so slicing source by `line_start` alone silently
    drops every decorator. Widen the start to the earliest decorator line
    when there are any.
    """
    if not def_node.decorator_list:
        return fallback_start
    return min(fallback_start, min(d.lineno for d in def_node.decorator_list))


def _read_source(root: Path, node: Node, def_node: DefNode | None) -> str | None:
    try:
        lines = (root / node.file).read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    start = node.line_start
    if def_node is not None:
        start = _decorator_inclusive_start(def_node, start)
    return "\n".join(lines[start - 1 : node.line_end])


def _render_signature(def_node: DefNode, *, strip_decorators: bool) -> str | None:
    """Reconstructs an exact `def foo(...) -> ...:` / `class Foo(...):`
    header from the AST -- a shallow-copied def/class node with its body
    replaced by `pass`, unparsed and reduced to its first line -- rather
    than text-slicing a possibly multi-line header out of the source.

    Callee/caller signatures strip decorators to stay a single compact
    line in the context's bullet lists; the target function itself keeps
    them (see `strip_decorators=False` callers) since they're often the
    most important fact about it (e.g. an HTTP route, a `@property`).
    """
    stripped = copy.copy(def_node)
    stripped.body = [ast.Pass()]
    if strip_decorators:
        stripped.decorator_list = []
    try:
        rendered = ast.unparse(stripped)
    except (ValueError, TypeError):
        return None
    # Without decorators, `rendered` is just the one-line header plus a
    # trailing `pass` body line -- take the first line. With decorators
    # kept (the target function), the header itself spans multiple lines
    # (one per decorator), so instead strip only the trailing body line.
    if strip_decorators:
        return rendered.splitlines()[0]
    return rendered.rsplit("\n    pass", 1)[0]


def _signature(
    root: Path, node: Node, trees: dict[str, ast.Module | None], *, strip_decorators: bool = True
) -> str | None:
    def_node = locate(root, node, trees)
    if def_node is None:
        return None
    return _render_signature(def_node, strip_decorators=strip_decorators)


def _parent_class(result: ParseResult, node: Node, nodes_by_id: dict[str, Node]) -> Node | None:
    for edge in result.edges:
        if edge.kind != EdgeKind.DEFINES or edge.target != node.id:
            continue
        source_node = nodes_by_id.get(edge.source)
        if source_node is not None and source_node.kind == NodeKind.CLASS:
            return source_node
    return None


def _direct_related(
    result: ParseResult, node_id: str, nodes_by_id: dict[str, Node], *, callees: bool
) -> list[Node]:
    related_ids: list[str] = []
    seen: set[str] = set()
    for edge in result.edges:
        if edge.kind != EdgeKind.CALLS:
            continue
        if callees:
            if edge.source != node_id or edge.external:
                continue
            other_id = edge.target
        else:
            if edge.target != node_id:
                continue
            other_id = edge.source
        if other_id in seen:
            continue
        other_node = nodes_by_id.get(other_id)
        if other_node is None:
            continue
        seen.add(other_id)
        related_ids.append(other_id)

    related = [nodes_by_id[i] for i in related_ids]
    related.sort(key=lambda n: n.id)
    return related


def assemble_context(
    result: ParseResult, node_id: str, max_tokens: int = MAX_CONTEXT_TOKENS
) -> DocContext:
    """Assumes `node_id` refers to an existing `FUNCTION` node -- callers
    (the `/api/generate-doc` route) are expected to validate that first,
    the same division of responsibility `analysis.impact.find_upstream_callers`
    uses for its `target`.
    """
    root = Path(result.root)
    nodes_by_id = {n.id: n for n in result.nodes}
    node = nodes_by_id[node_id]
    trees: dict[str, ast.Module | None] = {}

    budget = max_tokens
    sections: list[str] = []
    omitted: list[str] = []

    target_def_node = locate(root, node, trees)
    source = _read_source(root, node, target_def_node) or ""
    signature = (
        (target_def_node and _render_signature(target_def_node, strip_decorators=False))
        or f"def {node.label}(...):"
    )
    target_block = f"## Target function\n\n{signature}\n\n```python\n{source}\n```"
    sections.append(target_block)
    budget -= _approx_tokens(target_block)

    parent_node = _parent_class(result, node, nodes_by_id)
    callees = _direct_related(result, node_id, nodes_by_id, callees=True)
    callers = _direct_related(result, node_id, nodes_by_id, callees=False)

    def _add_signature_list(title: str, related: list[Node]) -> None:
        nonlocal budget
        if not related:
            return
        lines: list[str] = []
        dropped = 0
        for related_node in related:
            sig = _signature(root, related_node, trees) or f"def {related_node.label}(...):"
            if _approx_tokens(sig) <= budget:
                lines.append(sig)
                budget -= _approx_tokens(sig)
            else:
                dropped += 1
        if lines:
            block = f"## {title}\n\n" + "\n".join(f"- `{line}`" for line in lines)
            sections.append(block)
        if dropped:
            omitted.append(f"{title} ({dropped})")

    _add_signature_list("Direct callees", callees)
    _add_signature_list("Direct callers", callers)

    if parent_node is not None:
        header = _signature(root, parent_node, trees) or f"class {parent_node.label}:"
        block = f"## Parent class\n\n`{header}`"
        if _approx_tokens(block) <= budget:
            sections.append(block)
            budget -= _approx_tokens(block)
        else:
            omitted.append("Parent class")

    prompt = "\n\n".join(sections)
    return DocContext(node_id=node_id, prompt=prompt, omitted=omitted)
