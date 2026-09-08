"""Churn-weighted hotspot scoring: combines a complexity index with a
per-file git-churn count (`git_ops.compute_file_churn`) into a ranked list
of `complexity x churn` scores. Pure, in-memory combination logic -- all
git and AST work happens elsewhere (`git_ops.py`, `complexity.py`).
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from pydantic import BaseModel

from semantic_vision.analysis.complexity import ComplexityScore


class HotspotScore(BaseModel):
    node_id: str
    cyclomatic_complexity: int
    change_count: int
    hotspot_score: int


def build_hotspot_scores(
    complexity_index: dict[str, ComplexityScore],
    churn_by_file: dict[str, int],
    *,
    offset: Path,
) -> list[HotspotScore]:
    """Joins a complexity index (keyed `"{file relative to the parsed
    path}::{qualname}"`) against a churn map (keyed by file path relative
    to the git root) and ranks the result by `cyclomatic_complexity *
    change_count`, descending.

    `offset` is the parsed path's location relative to the git root (e.g.
    `Path("backend")` if the repo was parsed at `<git_root>/backend`, or
    `Path(".")`/empty if the parsed path *is* the git root) -- required
    because a node id's file component is relative to the parsed path, not
    the git root, so the two only line up directly when they're the same
    directory. This mirrors the exact offset computation
    `git_ops.build_ref_complexity_index` already uses for the same reason.
    A file with no churn entry (untouched in the window, or untracked)
    defaults to a change count of 0.
    """
    offset_posix = offset.as_posix()
    scores = []
    for node_id, score in complexity_index.items():
        file_part, _, _qualname = node_id.partition("::")
        if offset_posix in ("", "."):
            git_relative = file_part
        else:
            git_relative = (PurePosixPath(offset_posix) / file_part).as_posix()
        change_count = churn_by_file.get(git_relative, 0)
        scores.append(
            HotspotScore(
                node_id=node_id,
                cyclomatic_complexity=score.cyclomatic_complexity,
                change_count=change_count,
                hotspot_score=score.cyclomatic_complexity * change_count,
            )
        )

    scores.sort(key=lambda s: s.hotspot_score, reverse=True)
    return scores
