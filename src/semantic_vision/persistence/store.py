"""Reads/writes a repository's `.visualiser/` persistence directory:

    .visualiser/
      graph_state.json   -- saved node positions
      metadata.json       -- stats from the last successful parse
      docs/
        index.json         -- node id -> doc hash/timestamp lookup
        {hash}.md           -- saved AI-generated documentation

Files here are hand-editable/deletable by a user and may be stale or
malformed (e.g. from an older schema version); every read tolerates a
missing or corrupt file by falling back to an empty/default value rather
than raising, consistent with the parser's own "never let one bad input
abort the operation" approach.
"""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ValidationError

from semantic_vision.persistence.models import (
    DocIndex,
    DocIndexEntry,
    GraphState,
    NodePosition,
    RepoMetadata,
)

_GRAPH_STATE_FILENAME = "graph_state.json"
_METADATA_FILENAME = "metadata.json"
_DOCS_INDEX_FILENAME = "index.json"


def resolve_doc_root(parsed_root: Path, requested: str | None) -> Path:
    """Where `.visualiser/` should actually live for a parsed repository.

    Parsing a large repository can be scoped down to a single subfolder
    for performance (e.g. `src/myapp/api/` instead of the whole tree);
    `.visualiser/` naively living at that scoped path would scatter saved
    docs/positions across whichever subfolder happened to be open when
    they were saved, and the same function's doc would be invisible again
    the next time a *different* scope of the same project is loaded.

    `requested` (an explicit path the caller asked for) always wins. Its
    resolution is *stable*, so repeatedly asking for the same value with
    or without a trailing separator, `.`/`..` segments, etc. all end up
    at the same key.

    Without one, the nearest ancestor directory containing `.git` is used
    -- a reasonably reliable "this is the project" signal that doesn't
    depend on how much of the tree was scoped in for parsing. Falls back
    to `parsed_root` itself (today's behavior) if no `.git` is found.
    """
    if requested:
        return Path(requested).resolve()

    current = parsed_root.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return current


def _visualiser_dir(repo_root: Path) -> Path:
    return repo_root / ".visualiser"


def _docs_dir(repo_root: Path) -> Path:
    return _visualiser_dir(repo_root) / "docs"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _read_json_model[T: BaseModel](path: Path, model: type[T]) -> T | None:
    if not path.is_file():
        return None
    try:
        return model.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValidationError):
        return None


def _write_json_model(path: Path, payload: BaseModel) -> None:
    """Writes via a temp file + atomic rename so a crash or an interrupted
    write mid-flight can never leave a truncated/corrupt file behind for
    the next read to (silently) treat as absent."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
    os.replace(tmp_path, path)


def read_graph_state(repo_root: Path) -> GraphState:
    path = _visualiser_dir(repo_root) / _GRAPH_STATE_FILENAME
    return _read_json_model(path, GraphState) or GraphState()


def write_graph_state(repo_root: Path, positions: dict[str, NodePosition]) -> GraphState:
    """Merges `positions` into whatever was already saved, rather than
    replacing the file wholesale. A save only ever carries positions for
    the nodes a client currently has rendered -- e.g. the frontend's File
    view intentionally shows a scoped subset of the graph -- so a naive
    replace would silently discard every other node's saved position on
    the next autosave. Stale entries for nodes that no longer exist in
    the graph are harmless (callers only ever look up ids that are
    actually present) and aren't pruned here.
    """
    existing = read_graph_state(repo_root)
    merged_positions = {**existing.positions, **positions}
    state = GraphState(positions=merged_positions, updated_at=_now())
    _write_json_model(_visualiser_dir(repo_root) / _GRAPH_STATE_FILENAME, state)
    return state


def read_metadata(repo_root: Path) -> RepoMetadata | None:
    path = _visualiser_dir(repo_root) / _METADATA_FILENAME
    return _read_json_model(path, RepoMetadata)


def write_metadata(
    repo_root: Path, *, node_count: int, edge_count: int, parse_error_count: int
) -> RepoMetadata:
    metadata = RepoMetadata(
        node_count=node_count,
        edge_count=edge_count,
        parse_error_count=parse_error_count,
        parsed_at=_now(),
    )
    _write_json_model(_visualiser_dir(repo_root) / _METADATA_FILENAME, metadata)
    return metadata


def doc_hash(node_id: str) -> str:
    return hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:16]


def read_docs_index(repo_root: Path) -> DocIndex:
    path = _docs_dir(repo_root) / _DOCS_INDEX_FILENAME
    return _read_json_model(path, DocIndex) or DocIndex()


def read_doc(repo_root: Path, node_id: str) -> str | None:
    index = read_docs_index(repo_root)
    entry = next((e for e in index.entries if e.node_id == node_id), None)
    if entry is None:
        return None
    doc_path = _docs_dir(repo_root) / f"{entry.hash}.md"
    try:
        return doc_path.read_text(encoding="utf-8")
    except OSError:
        return None


def write_doc(repo_root: Path, node_id: str, markdown: str) -> DocIndexEntry:
    entry = DocIndexEntry(node_id=node_id, hash=doc_hash(node_id), updated_at=_now())
    docs_dir = _docs_dir(repo_root)
    docs_dir.mkdir(parents=True, exist_ok=True)
    (docs_dir / f"{entry.hash}.md").write_text(markdown, encoding="utf-8")

    index = read_docs_index(repo_root)
    index.entries = [e for e in index.entries if e.node_id != node_id]
    index.entries.append(entry)
    _write_json_model(docs_dir / _DOCS_INDEX_FILENAME, index)
    return entry
