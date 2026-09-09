"""Coverage-vs-blast-radius risk ranking (see
docs/ideas/REPO-INTELLIGENCE-IDEAS.md's Idea 4): cross-references a
per-function coverage ratio (from an ingested coverage report -- see
`coverage_ingest.py`) against two numbers the report already computes for
every function: cyclomatic complexity and upstream blast radius (the
transitive-caller count `analysis/impact.py`'s `find_upstream_callers`
already produces for the impact-analysis panel). Pure in-memory join, no
new traversal machinery beyond what impact analysis already provides.
"""

from __future__ import annotations

from pydantic import BaseModel

from semantic_vision.analysis.complexity import ComplexityScore
from semantic_vision.analysis.impact import DEFAULT_MAX_DEPTH, find_upstream_callers
from semantic_vision.models import EdgeKind, Node, NodeKind


class CoverageRiskScore(BaseModel):
    node_id: str
    cyclomatic_complexity: int
    blast_radius: int
    coverage_ratio: float | None
    """Fraction (0.0-1.0) of this function's own source lines the
    ingested coverage report marks as hit. `None` when the report has no
    entry at all for this function's file (not "0% covered" -- a
    genuinely different, worse-in-a-different-way state the UI badges
    distinctly) or when the file's entry exists but none of the report's
    recorded line numbers fall inside this function's own
    `line_start`-`line_end` range."""
    risk_score: float
    """`cyclomatic_complexity * (1 + blast_radius) * (1 - coverage_ratio)`,
    treating a `None` coverage_ratio as `0.0` (worst case) so a function
    with no coverage data still ranks by complexity x blast-radius alone
    rather than dropping out of the ranking entirely."""


def build_coverage_risk_scores(
    nodes: list[Node],
    complexity_index: dict[str, ComplexityScore],
    reverse_index: dict[str, list[tuple[str, EdgeKind]]],
    line_hits_by_file: dict[str, dict[int, int]],
) -> list[CoverageRiskScore]:
    scores: list[CoverageRiskScore] = []
    for node in nodes:
        if node.kind != NodeKind.FUNCTION:
            continue

        complexity = complexity_index.get(node.id)
        cyclomatic_complexity = complexity.cyclomatic_complexity if complexity is not None else 1

        blast_radius = len(
            find_upstream_callers(node.id, reverse_index, max_depth=DEFAULT_MAX_DEPTH).callers
        )

        file_hits = line_hits_by_file.get(node.file.replace("\\", "/"))
        coverage_ratio: float | None
        if file_hits is None:
            coverage_ratio = None
        else:
            lines_in_range = [
                hits for line, hits in file_hits.items() if node.line_start <= line <= node.line_end
            ]
            coverage_ratio = (
                sum(1 for hits in lines_in_range if hits > 0) / len(lines_in_range)
                if lines_in_range
                else None
            )

        risk_score = cyclomatic_complexity * (1 + blast_radius) * (1 - (coverage_ratio or 0.0))
        scores.append(
            CoverageRiskScore(
                node_id=node.id,
                cyclomatic_complexity=cyclomatic_complexity,
                blast_radius=blast_radius,
                coverage_ratio=coverage_ratio,
                risk_score=round(risk_score, 2),
            )
        )

    scores.sort(key=lambda s: s.risk_score, reverse=True)
    return scores
