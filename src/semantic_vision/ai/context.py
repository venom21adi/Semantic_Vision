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
from typing import Literal

import tree_sitter
from pydantic import BaseModel

from semantic_vision import ast_locate, ts_locate
from semantic_vision.models import EdgeKind, Node, NodeKind, ParseResult
from semantic_vision.parser import javascript_extractor
from semantic_vision.parser.javascript_extractor import _CLASS_DECLARATION_TYPES

MAX_CONTEXT_TOKENS = 2000

AnyDefNode = ast_locate.DefNode | tree_sitter.Node

_JS_EXTENSIONS = frozenset(javascript_extractor.GRAMMAR_BY_EXTENSION)


def _is_js_file(file: str) -> bool:
    return file.endswith(tuple(_JS_EXTENSIONS))


_FENCE_LANGUAGE_BY_EXTENSION = {
    ".py": "python",
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
}


def _fence_language(file: str) -> str:
    for ext, language in _FENCE_LANGUAGE_BY_EXTENSION.items():
        if file.endswith(ext):
            return language
    return ""


class DocContext(BaseModel):
    node_id: str
    prompt: str
    """Fully assembled context text, ready to send as the user message."""
    omitted: list[str]
    """Section names dropped or truncated to stay within the token budget."""
    kind: Literal["function", "file"] = "function"
    """Which system prompt `ai.providers.stream_documentation` should pair
    this with -- a function doc and a file doc ask the model for
    differently-shaped Markdown (see `SYSTEM_PROMPT`/`FILE_SYSTEM_PROMPT`
    there), so the context and the prompt template must stay matched."""


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _decorator_inclusive_start(def_node: AnyDefNode, fallback_start: int) -> int:
    """`FunctionDef.lineno`/`ClassDef.lineno` (and hence `Node.line_start`,
    which is derived from it) point at the `def`/`class` keyword line, not
    the first decorator -- so slicing source by `line_start` alone silently
    drops every decorator. Widen the start to the earliest decorator line
    when there are any.
    """
    if isinstance(def_node, tree_sitter.Node):
        decorators = _decorators_of(def_node)
        if not decorators:
            return fallback_start
        return min(fallback_start, min(d.start_point[0] + 1 for d in decorators))
    if not def_node.decorator_list:
        return fallback_start
    return min(fallback_start, min(d.lineno for d in def_node.decorator_list))


def _read_source(root: Path, node: Node, def_node: AnyDefNode | None) -> str | None:
    try:
        lines = (root / node.file).read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    start = node.line_start
    if def_node is not None:
        start = _decorator_inclusive_start(def_node, start)
    return "\n".join(lines[start - 1 : node.line_end])


def _decorators_of(node: tree_sitter.Node) -> list[tree_sitter.Node]:
    """A decorator on a class declaration is that `class_declaration`
    node's own leading child -- its span *starts* at the decorator,
    confirmed live via tree-sitter. A decorator on a class member (a
    method/field) is instead a preceding sibling within `class_body`,
    matching `javascript_extractor.py`'s own `pending_decorators`
    handling. Unlike Python's `decorator_list`, which is uniformly part
    of the def node either way, JS/TS needs both cases handled.
    """
    if node.type in _CLASS_DECLARATION_TYPES:
        # `export [default] class Foo {}` wraps the class in an
        # `export_statement`, and a decorator on such a class is a child
        # of *that* wrapper, not of the class_declaration itself --
        # confirmed live, distinct from the bare (non-exported) case.
        parent = node.parent
        is_exported = parent is not None and parent.type == "export_statement"
        container = parent if is_exported else node
        leading: list[tree_sitter.Node] = []
        for child in container.children:
            if child.type != "decorator":
                break
            leading.append(child)
        return leading

    decorators: list[tree_sitter.Node] = []
    sibling = node.prev_sibling
    while sibling is not None and sibling.type == "decorator":
        decorators.append(sibling)
        sibling = sibling.prev_sibling
    decorators.reverse()
    return decorators


def _declaration_keyword(value_node: tree_sitter.Node) -> str:
    """The real `const`/`let`/`var` keyword a declarator-bound function/
    class value was declared with, walked up via `value -> declarator ->
    declaration statement` (holds regardless of how many other
    declarators share the same statement, e.g. `let a = 1, b = () => {}`
    -- a declarator's parent is always the declaration statement
    directly). Falls back to "const" for a shape this can't happen for
    in practice (a field-bound value, which has no such statement)."""
    declarator = value_node.parent
    statement = declarator.parent if declarator is not None else None
    if statement is not None and statement.type in ("lexical_declaration", "variable_declaration"):
        first = statement.children[0] if statement.children else None
        if first is not None and first.type in ("const", "let", "var"):
            return first.text.decode("utf-8")
    return "const"


def _render_py_signature(def_node: ast_locate.DefNode, *, strip_decorators: bool) -> str | None:
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


def _render_ts_signature(
    def_node: tree_sitter.Node, label: str, *, strip_decorators: bool
) -> str | None:
    """The tree-sitter analogue: slices the real header text straight out
    of the source (from the node's own start to its `body` field's
    start) rather than reconstructing one -- tree-sitter has no unparse/
    codegen API, and unlike Python's `ast`, it preserves exact source
    text, so slicing is the natural, always-exact way to get it.

    `function_declaration`/`class_declaration`/`method_definition` (etc.)
    carry their own name in the sliced text already. A declarator- or
    field-bound arrow function/class expression does not -- its name
    lives on the sibling declarator/field, not the value node itself --
    so `label` (already known by the caller from the graph `Node`) is
    prepended synthetically for those.
    """
    decorators = _decorators_of(def_node)
    # A *non-exported* class declaration's decorator is its own leading
    # child (its span starts at the decorator) -- the header slice must
    # start *after* it, or it ends up baked into `header` unconditionally
    # regardless of `strip_decorators`. An *exported* class's decorator
    # instead lives on the wrapping `export_statement`, entirely outside
    # `def_node`'s own span -- as does a method's (a sibling) -- so no
    # slice adjustment is needed for either of those; only actually
    # checking whether the decorator's span starts where `def_node`'s
    # does tells the two apart.
    core_start = def_node.start_byte
    if decorators and decorators[0].start_byte == def_node.start_byte:
        core_start = decorators[-1].end_byte

    body = def_node.child_by_field_name("body")
    end = body.start_byte if body is not None else def_node.end_byte
    header_bytes = def_node.text[core_start - def_node.start_byte : end - def_node.start_byte]
    header = " ".join(header_bytes.decode("utf-8").split())

    if def_node.type == "class":
        # An anonymous class expression's own text already starts with
        # the literal "class" keyword (it has no name of its own to
        # slice past) -- strip it before prepending "class {label}"
        # ourselves, or it duplicates ("class Base class extends X").
        if header.startswith("class"):
            header = header[len("class") :].strip()
        header = f"class {label} {header}".rstrip()
    elif def_node.type in ("arrow_function", "function_expression", "generator_function"):
        header = f"{_declaration_keyword(def_node)} {label} = {header}"

    if strip_decorators or not decorators:
        return header

    decorator_lines = "\n".join(d.text.decode("utf-8") for d in decorators)
    return f"{decorator_lines}\n{header}"


def _render_signature(def_node: AnyDefNode, label: str, *, strip_decorators: bool) -> str | None:
    if isinstance(def_node, tree_sitter.Node):
        return _render_ts_signature(def_node, label, strip_decorators=strip_decorators)
    return _render_py_signature(def_node, strip_decorators=strip_decorators)


def _locate(
    root: Path,
    node: Node,
    ast_trees: dict[str, ast.Module | None],
    ts_trees: dict[str, tree_sitter.Tree | None],
) -> AnyDefNode | None:
    if _is_js_file(node.file):
        return ts_locate.locate(root, node, ts_trees)
    return ast_locate.locate(root, node, ast_trees)


def _signature(
    root: Path,
    node: Node,
    ast_trees: dict[str, ast.Module | None],
    ts_trees: dict[str, tree_sitter.Tree | None],
    *,
    strip_decorators: bool = True,
) -> str | None:
    def_node = _locate(root, node, ast_trees, ts_trees)
    if def_node is None:
        return None
    return _render_signature(def_node, node.label, strip_decorators=strip_decorators)


def _parent_class(result: ParseResult, node: Node, nodes_by_id: dict[str, Node]) -> Node | None:
    for edge in result.edges:
        if edge.kind != EdgeKind.DEFINES or edge.target != node.id:
            continue
        source_node = nodes_by_id.get(edge.source)
        if source_node is not None and source_node.kind == NodeKind.CLASS:
            return source_node
    return None


def _direct_defines(
    result: ParseResult, parent_id: str, nodes_by_id: dict[str, Node]
) -> list[Node]:
    """Direct `DEFINES` children of `parent_id` (a file's own top-level
    classes/functions, or a class's own methods), in source order --
    unlike `_direct_related`'s id-sort (call targets have no inherent
    order), a file's members read naturally top-to-bottom the way they
    appear in the source.
    """
    children = [
        nodes_by_id[edge.target]
        for edge in result.edges
        if edge.kind == EdgeKind.DEFINES and edge.source == parent_id and edge.target in nodes_by_id
    ]
    children.sort(key=lambda n: n.line_start)
    return children


def _render_define_entry(
    result: ParseResult,
    root: Path,
    node: Node,
    nodes_by_id: dict[str, Node],
    ast_trees: dict[str, ast.Module | None],
    ts_trees: dict[str, tree_sitter.Tree | None],
    *,
    depth: int = 0,
) -> str:
    """One `Defines` bullet, recursing into a class's own members at any
    depth -- not just one level -- so a class nested inside a class still
    has its own methods listed instead of silently vanishing (a class
    nested inside a *function*, e.g. a factory-local helper class, has no
    `DEFINES` edge from the file at all and so is out of scope here, same
    as any other function-local name)."""
    sig = _signature(root, node, ast_trees, ts_trees) or _fallback_signature(node)
    lines = [f"{'  ' * depth}- `{sig}`"]
    if node.kind == NodeKind.CLASS:
        for member in _direct_defines(result, node.id, nodes_by_id):
            lines.append(
                _render_define_entry(
                    result, root, member, nodes_by_id, ast_trees, ts_trees, depth=depth + 1
                )
            )
    return "\n".join(lines)


def _import_label(target: str, nodes_by_id: dict[str, Node]) -> str:
    """A resolved import target is a real node id (a file, or a specific
    symbol within one) -- use its label. An external target is the
    synthetic `external::{qualname}` id `resolver/imports.py`/
    `resolver/js_imports.py` produce for anything outside the parsed repo
    -- show the qualname. Anything else (an ambiguous edge whose target
    couldn't be narrowed past the file) falls back to the id's own last
    `::`-segment, which is always at least the file/symbol's own name.

    A `FILE` node's `label` is its filename including extension (e.g.
    `helper.py`) -- fine standing alone, but inconsistent right next to a
    named-symbol import's bare-name label (`helper`) in the same list, so
    it's stripped here for a whole-module import to match.
    """
    if target in nodes_by_id:
        resolved = nodes_by_id[target]
        return Path(resolved.label).stem if resolved.kind == NodeKind.FILE else resolved.label
    if target.startswith("external::"):
        return target.removeprefix("external::")
    return target.rsplit("::", 1)[-1]


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


def _fallback_signature(node: Node) -> str:
    if node.kind == NodeKind.CLASS:
        return f"class {node.label}:"
    keyword = "function" if _is_js_file(node.file) else "def"
    return f"{keyword} {node.label}(...):"


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
    ast_trees: dict[str, ast.Module | None] = {}
    ts_trees: dict[str, tree_sitter.Tree | None] = {}

    budget = max_tokens
    sections: list[str] = []
    omitted: list[str] = []

    target_def_node = _locate(root, node, ast_trees, ts_trees)
    source = _read_source(root, node, target_def_node) or ""
    signature = (
        (target_def_node and _render_signature(target_def_node, node.label, strip_decorators=False))
        or _fallback_signature(node)
    )
    fence = _fence_language(node.file)
    target_block = f"## Target function\n\n{signature}\n\n```{fence}\n{source}\n```"
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
            sig = _signature(root, related_node, ast_trees, ts_trees) or _fallback_signature(
                related_node
            )
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
        header = _signature(root, parent_node, ast_trees, ts_trees) or _fallback_signature(
            parent_node
        )
        block = f"## Parent class\n\n`{header}`"
        if _approx_tokens(block) <= budget:
            sections.append(block)
            budget -= _approx_tokens(block)
        else:
            omitted.append("Parent class")

    prompt = "\n\n".join(sections)
    return DocContext(node_id=node_id, prompt=prompt, omitted=omitted, kind="function")


def assemble_file_context(
    result: ParseResult, node_id: str, max_tokens: int = MAX_CONTEXT_TOKENS
) -> DocContext:
    """Assumes `node_id` refers to an existing `FILE` node -- same
    validation split as `assemble_context` (the `/api/generate-doc` route
    checks first).

    Deliberately never inlines a function/class body -- only its rendered
    signature, via the same `_signature` machinery `assemble_context` uses
    for its callee/caller lists. That keeps this prompt's size roughly
    independent of the file's length (a 2000-line file costs about the
    same as a 20-line one here), matching a high-level module summary
    rather than a per-function walkthrough -- the per-function walkthrough
    is what opening each function's own doc already gives you, and
    inlining every body here would both blow the token budget on any
    real-sized file and duplicate that.
    """
    root = Path(result.root)
    nodes_by_id = {n.id: n for n in result.nodes}
    node = nodes_by_id[node_id]
    ast_trees: dict[str, ast.Module | None] = {}
    ts_trees: dict[str, tree_sitter.Tree | None] = {}

    budget = max_tokens
    sections: list[str] = []
    omitted: list[str] = []

    header_block = f"## File\n\n`{node.file}`"
    sections.append(header_block)
    budget -= _approx_tokens(header_block)

    import_targets = sorted(
        {
            _import_label(edge.target, nodes_by_id)
            for edge in result.edges
            if edge.kind == EdgeKind.IMPORTS and edge.source == node_id
        }
    )
    if import_targets:
        block = "## Imports\n\n" + "\n".join(f"- `{target}`" for target in import_targets)
        if _approx_tokens(block) <= budget:
            sections.append(block)
            budget -= _approx_tokens(block)
        else:
            omitted.append("Imports")

    defines_header = "## Defines\n\n"
    top_level = _direct_defines(result, node_id, nodes_by_id)
    entries: list[str] = []
    dropped = 0
    header_charged = False
    for child in top_level:
        entry = _render_define_entry(result, root, child, nodes_by_id, ast_trees, ts_trees)
        # The header is only charged against the budget once, the first
        # time it would actually be included -- mirrors the `Imports`
        # block's all-or-nothing charge instead of leaving it free, but
        # doesn't tax a file whose `Defines` section ends up empty/fully
        # dropped for one that never needed the header at all.
        cost = _approx_tokens(entry) + (0 if header_charged else _approx_tokens(defines_header))
        if cost <= budget:
            entries.append(entry)
            budget -= cost
            header_charged = True
        else:
            dropped += 1
    if entries:
        block = defines_header + "\n".join(entries)
        sections.append(block)
    if dropped:
        omitted.append(f"Defines ({dropped})")

    prompt = "\n\n".join(sections)
    return DocContext(node_id=node_id, prompt=prompt, omitted=omitted, kind="file")
