from pathlib import Path

import pytest

from semantic_vision.analysis import coverage_ingest


def _write(tmp_path: Path, name: str, content: str) -> str:
    file_path = tmp_path / name
    file_path.write_text(content, encoding="utf-8")
    return str(file_path)


def test_parses_coverage_xml_into_per_file_per_line_hits(tmp_path):
    xml = """<?xml version="1.0" ?>
<coverage>
  <packages>
    <package name="app">
      <classes>
        <class filename="app.py">
          <lines>
            <line number="1" hits="3"/>
            <line number="2" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
"""
    path = _write(tmp_path, "coverage.xml", xml)

    result = coverage_ingest.parse_coverage_file(path)

    assert result == {"app.py": {1: 3, 2: 0}}


def test_normalizes_windows_style_paths_in_xml(tmp_path):
    xml = (
        "<coverage><packages><package><classes>"
        '<class filename="src\\app\\main.py"><lines><line number="1" hits="1"/></lines></class>'
        "</classes></package></packages></coverage>"
    )
    path = _write(tmp_path, "coverage.xml", xml)

    result = coverage_ingest.parse_coverage_file(path)

    assert result == {"src/app/main.py": {1: 1}}


def test_xml_with_no_class_entries_raises_coverage_parse_error(tmp_path):
    path = _write(tmp_path, "coverage.xml", "<coverage><packages/></coverage>")

    with pytest.raises(coverage_ingest.CoverageParseError):
        coverage_ingest.parse_coverage_file(path)


def test_invalid_xml_raises_coverage_parse_error(tmp_path):
    path = _write(tmp_path, "coverage.xml", "<coverage><packages>")

    with pytest.raises(coverage_ingest.CoverageParseError):
        coverage_ingest.parse_coverage_file(path)


def test_parses_lcov_report_into_per_file_per_line_hits(tmp_path):
    lcov = "SF:app.py\nDA:1,2\nDA:2,0\nend_of_record\n"
    path = _write(tmp_path, "lcov.info", lcov)

    result = coverage_ingest.parse_coverage_file(path)

    assert result == {"app.py": {1: 2, 2: 0}}


def test_lcov_with_multiple_files_keeps_them_separate(tmp_path):
    lcov = "SF:a.py\nDA:1,1\nend_of_record\nSF:b.py\nDA:1,0\nend_of_record\n"
    path = _write(tmp_path, "lcov.info", lcov)

    result = coverage_ingest.parse_coverage_file(path)

    assert result == {"a.py": {1: 1}, "b.py": {1: 0}}


def test_lcov_with_no_sf_da_records_raises_coverage_parse_error(tmp_path):
    path = _write(tmp_path, "lcov.info", "TN:\nend_of_record\n")

    with pytest.raises(coverage_ingest.CoverageParseError):
        coverage_ingest.parse_coverage_file(path)


def test_missing_file_raises_coverage_parse_error(tmp_path):
    with pytest.raises(coverage_ingest.CoverageParseError):
        coverage_ingest.parse_coverage_file(str(tmp_path / "does-not-exist.xml"))
