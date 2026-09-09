"""Coverage-report ingestion (see docs/ideas/REPO-INTELLIGENCE-IDEAS.md's
Idea 4): parses a coverage report the user's own test-runner already
produced -- coverage.py's XML output, or an lcov text report -- into a
per-file, per-line hit-count map. Semantic Vision never runs the user's
test suite itself; this only reads an artifact that tooling already
produced, the same "user's own tooling as ground truth" principle
`dbt_ingest.py` and `db_introspect.py` already follow.
"""

from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET


class CoverageParseError(Exception):
    """Raised when the coverage file can't be read or doesn't look like a
    recognized coverage.py XML or lcov report -- the API layer turns this
    into a 400, not a crash."""


def _normalize_path(raw: str) -> str:
    return raw.replace("\\", "/").removeprefix("./")


def _parse_xml(raw: str) -> dict[str, dict[int, int]]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise CoverageParseError(f"Not valid coverage XML: {exc}") from exc

    hits_by_file: dict[str, dict[int, int]] = {}
    for class_el in root.iter("class"):
        filename = class_el.get("filename")
        if not filename:
            continue
        lines_el = class_el.find("lines")
        if lines_el is None:
            continue
        file_hits = hits_by_file.setdefault(_normalize_path(filename), {})
        for line_el in lines_el.findall("line"):
            number = line_el.get("number")
            hits = line_el.get("hits")
            if number is None or hits is None:
                continue
            try:
                line_no, hit_count = int(number), int(hits)
            except ValueError:
                continue
            file_hits[line_no] = max(file_hits.get(line_no, 0), hit_count)

    if not hits_by_file:
        raise CoverageParseError(
            "Not a recognized coverage.py XML report: no <class> entries found"
        )
    return hits_by_file


_LCOV_SF_RE = re.compile(r"^SF:(.+)$")
_LCOV_DA_RE = re.compile(r"^DA:(\d+),(-?\d+)")


def _parse_lcov(raw: str) -> dict[str, dict[int, int]]:
    hits_by_file: dict[str, dict[int, int]] = {}
    current_file: str | None = None
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        sf_match = _LCOV_SF_RE.match(line)
        if sf_match:
            current_file = _normalize_path(sf_match.group(1))
            hits_by_file.setdefault(current_file, {})
            continue
        da_match = _LCOV_DA_RE.match(line)
        if da_match and current_file is not None:
            line_no, hit_count = int(da_match.group(1)), max(int(da_match.group(2)), 0)
            file_hits = hits_by_file[current_file]
            file_hits[line_no] = max(file_hits.get(line_no, 0), hit_count)
            continue
        if line == "end_of_record":
            current_file = None

    if not hits_by_file:
        raise CoverageParseError("Not a recognized lcov report: no 'SF:'/'DA:' records found")
    return hits_by_file


def parse_coverage_file(path: str) -> dict[str, dict[int, int]]:
    """Reads `path` (a coverage.py XML report, or an lcov text report the
    user's own test-runner already produced) and returns a per-file,
    per-line hit-count map, keyed by the report's own file paths
    (normalized to forward slashes so a report generated on Windows still
    matches a repo parsed the same way `Node.file` already is elsewhere in
    this project). Format is sniffed from content, not the file
    extension: an lcov report has no reliable extension convention
    (`.info`, `.lcov`, or nothing at all), so a leading `<` after
    stripping whitespace is the only reliable XML signal.
    """
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise CoverageParseError(f"Could not read coverage file: {exc}") from exc

    if raw.lstrip().startswith("<"):
        return _parse_xml(raw)
    return _parse_lcov(raw)
