#!/usr/bin/env python3
"""Validate Semantic Vision's C# call resolution against the real C# compiler.

For every call site in a repository, the .NET compiler (Roslyn, via `ground_truth/`) knows
exactly which method is called. This script asks Semantic Vision the same question and
reports how often the two agree, so resolution quality is a measured number rather than a
claim. It is the reproducible source of the figures in `guides/csharp.md`.

Usage (needs the .NET SDK for the ground truth; the comparison itself is pure Python):

    uv run python scripts/csharp/validate.py <repo-dir>
    uv run python scripts/csharp/validate.py <repo-dir> --show 5
    uv run python scripts/csharp/validate.py <repo-dir> --ground-truth gt.jsonl   # reuse a run
    uv run python scripts/csharp/validate.py <repo-dir> --min-recall 97 --min-precision 97

What is measured, per call site the compiler binds:

    recall     of the calls the compiler says go to a method in this repo, the share we
               attributed to that same method (an ambiguous set containing it also counts)
    precision  of the calls we attributed to a repo method, the share the compiler agrees with

Excluded, because the compiler gives no answer to compare against: calls it cannot bind
(they depend on NuGet packages it was not given). Sites are matched on (file, line, kind,
name); a few sites per repository (for example target-typed `new()`) have no counterpart.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "src"))

from semantic_vision.languages.csharp import _make_adapter, _State  # noqa: E402
from semantic_vision.parser.csharp_extractor import _symbol_defined  # noqa: E402
from semantic_vision.parser.discovery import discover_files  # noqa: E402
from semantic_vision.resolver import csharp_resolver as resolver  # noqa: E402
from semantic_vision.resolver.csharp_projects import ProjectMap  # noqa: E402

GROUND_TRUTH_PROJECT = ROOT / "scripts" / "csharp" / "ground_truth"
_CONDITION = re.compile(r"^\s*#\s*(?:if|elif)\b(.*)$")
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


@dataclass
class Report:
    repo: str
    counts: Counter = field(default_factory=Counter)
    samples: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))

    @property
    def true_internal(self) -> int:
        return sum(v for k, v in self.counts.items() if k.startswith("R-int"))

    @property
    def hits(self) -> int:
        return self.counts["R-int / hit-exact"] + self.counts["R-int / hit-ambiguous"]

    @property
    def predicted_internal(self) -> int:
        return (
            self.hits
            + self.counts["R-int / wrong-target"]
            + self.counts["R-ext / false-internal"]
            + self.counts["R-ext / false-internal-amb"]
        )

    @property
    def recall(self) -> float:
        return 100 * self.hits / self.true_internal if self.true_internal else 100.0

    @property
    def precision(self) -> float:
        return 100 * self.hits / self.predicted_internal if self.predicted_internal else 100.0


def defined_symbols(repo: Path) -> list[str]:
    """Preprocessor symbols the analyzer treats as defined, so the compiler looks at the
    same `#if` branches (it otherwise assumes none are defined)."""
    found: set[str] = set()
    for path in repo.rglob("*.cs"):
        if {"bin", "obj", ".git"} & set(path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8-sig", errors="ignore")
        except OSError:
            continue
        for line in text.splitlines():
            m = _CONDITION.match(line)
            if m:
                found.update(_IDENT.findall(m.group(1).split("//")[0]))
    return sorted(s for s in found - {"true", "false"} if _symbol_defined(s))


def run_ground_truth(repo: Path, out: Path) -> None:
    dotnet = shutil.which("dotnet")
    if dotnet is None:
        sys.exit("the .NET SDK (`dotnet`) is required to produce ground truth; see --ground-truth")
    cmd = [dotnet, "run", "--project", str(GROUND_TRUTH_PROJECT), "-c", "Release", "--",
           str(repo), str(out), *defined_symbols(repo)]  # fmt: skip
    subprocess.run(cmd, check=True)


def _target_key(index: resolver.CsIndex, node_id: str) -> tuple[str, str]:
    """`file::A.B.Method#2` -> (`B`, `Method`); a class node -> (`Class`, `.ctor`)."""
    decl = index.decl_by_class_id.get(node_id)
    if decl is not None:
        return decl.name, ".ctor"
    path = node_id.split("::", 1)[1] if "::" in node_id else node_id
    parts = [p.split("`")[0] for p in path.split(".")]
    if len(parts) == 1:
        return parts[0], ".ctor"
    cls, leaf = parts[-2], parts[-1].split("#")[0]
    return cls, (".ctor" if leaf == cls else leaf)


def our_answers(repo: Path):
    """Every call site we extracted, with what we resolve it to, keyed like the ground truth."""
    state = _State(ProjectMap.scan(repo))
    adapter = _make_adapter(state)
    modules = {}
    for path in discover_files(repo, adapter.file_extensions, adapter.excluded_dirs):
        rel = path.relative_to(repo).as_posix()
        try:
            modules[rel] = adapter.parse_file(
                path.read_text(encoding="utf-8-sig", errors="ignore"), rel
            )
        except Exception:  # noqa: BLE001 - an unparseable file simply has no answers
            continue
    index = resolver.CsIndex(modules, state.projects)
    resolver.mark_dispatch_targets(index)

    answers: dict[tuple, list] = defaultdict(list)
    for rel, raw in modules.items():

        def visit(cls, class_id: str, rel: str = rel) -> None:
            decl = index.decl_by_class_id.get(class_id)
            if decl is None:
                return
            groups = [(fn.lang_data, fn.lang_data.calls) for fn in cls.methods if fn.lang_data]
            if cls.lang_data is not None and cls.lang_data.init_data.calls:
                groups.append((cls.lang_data.init_data, cls.lang_data.init_data.calls))
            for data, calls in groups:
                ctx = resolver._Ctx(index, decl, data, rel)  # noqa: SLF001
                for call in calls:
                    name = ".ctor" if call.kind == "new" else call.name
                    answers[(rel, call.lineno, call.kind, name)].append(
                        (resolver.resolve_call(call, ctx), call)
                    )
            for nested in cls.nested_classes:
                visit(nested, f"{class_id}.{nested.name}")

        for cls in raw.classes:
            visit(cls, f"{rel}::{cls.name}")
    return index, answers


def compare(repo: Path, ground_truth: Path, show: int = 0) -> Report:
    index, ours = our_answers(repo)
    truth: dict[tuple, list] = defaultdict(list)
    for line in ground_truth.read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        truth[(d["file"], d["line"], d["kind"], d["name"])].append(d)

    report = Report(repo=str(repo))
    for key, truths in truth.items():
        mine = ours.get(key)
        if not mine:
            report.counts["gt-site-not-extracted"] += len(truths)
            continue
        for g, (res, _call) in zip(truths, mine, strict=False):
            if not g["bound"]:
                report.counts["gt-unbound"] += 1
                continue
            if res.kind == "skip":
                report.counts["mine-skip"] += 1
                continue
            if g["internal"]:
                want = (g["targetType"], g["targetName"])
                got = (
                    {_target_key(index, t) for t in res.targets}
                    if res.kind == "internal"
                    else set()
                )
                if want in got:
                    tag = "R-int / hit-exact" if len(got) == 1 else "R-int / hit-ambiguous"
                elif res.kind == "internal":
                    tag = "R-int / wrong-target"
                else:
                    tag = f"R-int / missed ({res.kind})"
            elif res.kind == "internal":
                tag = "R-ext / false-internal" + ("-amb" if res.ambiguous else "")
            else:
                tag = "R-ext / external-ok" if res.kind == "external" else "R-ext / unresolved"
            report.counts[tag] += 1
            if show and len(report.samples[tag]) < show:
                report.samples[tag].append(_describe(repo, key, g, res, index))
    return report


def _describe(repo: Path, key: tuple, g: dict, res, index) -> str:
    try:
        src = (
            (repo / key[0])
            .read_text(encoding="utf-8-sig", errors="ignore")
            .splitlines()[key[1] - 1]
        )
    except (OSError, IndexError):
        src = "?"
    mine = (
        [_target_key(index, t) for t in res.targets][:3] if res.kind == "internal" else res.display
    )
    return (
        f"  {key[0]}:{key[1]}  {src.strip()[:90]}\n"
        f"      compiler={g.get('targetType')}.{g.get('targetName')}"
        f"{'' if g['internal'] else ' (library)'}   ours={mine}"
    )


def print_report(report: Report) -> None:
    print(f"== {Path(report.repo).name} ==")
    for tag, n in sorted(report.counts.items()):
        print(f"  {tag:36s} {n:8d}")
    print(
        f"\nrecall    {report.hits}/{report.true_internal} = {report.recall:.1f}%"
        f"   (calls the compiler sends to repo code that we attribute correctly)"
    )
    print(
        f"precision {report.hits}/{report.predicted_internal} = {report.precision:.1f}%"
        f"   (repo targets we claim that the compiler agrees with)"
    )
    for tag, lines in report.samples.items():
        if tag.startswith(("R-int / wrong", "R-int / missed", "R-ext / false")):
            print(f"\n--- {tag}")
            print("\n".join(lines))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("repo", type=Path)
    ap.add_argument("--ground-truth", type=Path, help="reuse a previous ground-truth .jsonl")
    ap.add_argument("--show", type=int, default=0, help="print N example misses per category")
    ap.add_argument("--min-recall", type=float, default=0.0)
    ap.add_argument("--min-precision", type=float, default=0.0)
    args = ap.parse_args()

    repo = args.repo.resolve()
    if args.ground_truth:
        gt = args.ground_truth
    else:
        gt = Path(tempfile.mkdtemp(prefix="sv-csharp-gt-")) / "ground_truth.jsonl"
        run_ground_truth(repo, gt)
    report = compare(repo, gt, args.show)
    print_report(report)
    ok = report.recall >= args.min_recall and report.precision >= args.min_precision
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
