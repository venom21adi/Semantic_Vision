"""Opt-in: check C# resolution against the real C# compiler (Roslyn).

Needs the .NET SDK and network access for the Roslyn NuGet package on first run, so it is
skipped unless asked for:

    SV_CSHARP_ORACLE=1 uv run pytest tests/test_csharp_oracle.py

The fixture's expectations are also pinned, SDK-free, in `test_csharp_resolution.py`; this
test is what keeps those expectations honest (they must agree with the compiler)."""

import importlib.util
import os
import shutil
import sys
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "csharp_repo"
VALIDATE = Path(__file__).parent.parent / "scripts" / "csharp" / "validate.py"

pytestmark = pytest.mark.skipif(
    not (os.environ.get("SV_CSHARP_ORACLE") and shutil.which("dotnet")),
    reason="set SV_CSHARP_ORACLE=1 and install the .NET SDK to run the compiler oracle",
)


def _validator():
    spec = importlib.util.spec_from_file_location("sv_csharp_validate", VALIDATE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_fixture_agrees_with_the_compiler(tmp_path):
    validate = _validator()
    ground_truth = tmp_path / "gt.jsonl"
    validate.run_ground_truth(FIXTURE, ground_truth)
    report = validate.compare(FIXTURE, ground_truth)
    assert report.true_internal >= 25  # the fixture really exercises repo-internal calls
    assert report.recall == 100.0, dict(report.counts)
    assert report.precision == 100.0, dict(report.counts)
