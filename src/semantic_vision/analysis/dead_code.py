"""Dead-code candidate detection (see docs/ideas/REPO-INTELLIGENCE-IDEAS.md's
Idea 1): flags `FUNCTION` nodes with zero entries in the reverse
caller index `analysis/impact.py` already builds for `GET /api/impact`,
filtered through heuristics that suppress the common, legitimate ways a
function can have zero *in-repo* callers and still be very much alive --
none of which a call-graph traversal alone can see:

- Decorated (`Node.has_decorators`) -- a decorator, JS/TS decorator, or
  Java annotation is itself evidence of framework-managed invocation (a
  route handler, a pytest fixture, a DI-injected constructor), even when
  which framework isn't known.
- Defined in a test file, or named like a pytest test function -- a test
  runner discovers these by name/convention, not by a call this tool can
  see. JUnit's `@Test`-annotated methods are already covered by the
  decorator check above.
- A dunder/magic method (`__init__`, `__eq__`, ...) -- invoked implicitly
  by the language runtime, never as an explicit call in source.
- Named `main` -- the common `if __name__ == "__main__": main()` entry
  point. A real, deliberate simplification: this project's call-graph
  extraction doesn't track module-level statement calls at all (only
  calls made from inside a function/method body), so the guarded call
  itself is invisible either way; matching on the name is a coarser but
  much cheaper stand-in than teaching every extractor a new "module-level
  call" concept just for this one idiom.
- Listed in a Python module's `__all__` -- an explicit "this is public
  API" declaration, checked by parsing the defining file's own source
  with `ast` (a standalone local parse, not something `RawModule`/
  `symbol_table.py` track -- `__all__` is a plain assignment, not a
  symbol this project's graph otherwise cares about).

Deliberately conservative: a false negative (real dead code left off the
list) is the safe failure mode here, a false positive (telling someone a
framework-invoked function is dead) is not -- see the idea doc's own
"Cons" for why. Results are candidates to review, never a verdict.

Explicitly NOT attempted here, for the same reason the idea doc names it
as a known, unsolved gap rather than something to heuristically guess at:
telling a library's public API (meant to be imported by code outside this
repo, which this tool never sees) apart from a function that's really
unused. `__all__` covers the one case where that intent is written down
explicitly; nothing here tries to infer it otherwise.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path, PurePosixPath

from pydantic import BaseModel

from semantic_vision.models import EdgeKind, Node, NodeKind

_TEST_DIR_SEGMENTS = frozenset({"test", "tests", "__tests__", "spec"})


class DeadCodeCandidate(BaseModel):
    node_id: str


def _is_test_file(rel_file: str) -> bool:
    parts = PurePosixPath(rel_file).parts
    if not parts:
        return False
    if any(part.lower() in _TEST_DIR_SEGMENTS for part in parts[:-1]):
        return True
    name = parts[-1]
    lower = name.lower()
    if lower == "conftest.py":
        return True
    if lower.startswith("test_") or lower.endswith("_test.py"):
        return True
    if ".test." in lower or ".spec." in lower:
        return True
    if lower.endswith(".java"):
        # Case-preserved (not `lower`) and boundary-checked -- Java class
        # names are always CapitalCase, so a real test class reads as
        # "FooTest"/"TestFoo" with an exact-case "Test" substring at a
        # real camelCase word boundary. Matching case-insensitively (an
        # earlier version of this check did) treated any name that merely
        # *contains* the letters t-e-s-t as a test file -- confirmed to
        # false-positive on "Latest.java", "Contest.java", "Fastest.java".
        # The prefix branch needs its own boundary too: "Testimonials.java"
        # starts with "Test" but continues in lowercase, unlike the real
        # "TestForm.java" (uppercase word boundary) or bare "Test.java".
        stem = name[: -len(".java")]
        if stem.endswith("Test"):
            return True
        if stem.startswith("Test") and (
            len(stem) == 4 or not stem[4].isalpha() or stem[4].isupper()
        ):
            return True
    return False


def _looks_like_test_name(label: str) -> bool:
    return label.startswith("test_") or label == "test"


_DUNDER_RE = re.compile(r"^__[A-Za-z_][A-Za-z0-9_]*__$")


def _is_dunder(label: str) -> bool:
    return bool(_DUNDER_RE.match(label))


def _module_all_exports(root: Path, rel_file: str) -> set[str]:
    """Every string literal in a Python file's own module-level `__all__
    = [...]`/`(...)`/`{...}` assignment, found by parsing the file with
    `ast` -- not a regex. A regex scan of the raw text was tried first and
    rejected: a non-greedy match up to the first `]`/`)` breaks on
    anything with a bracket or a trailing comment inside the list (e.g.
    `"a",  # see foo[bar]` truncates the match right there, silently
    dropping every name after it) -- exactly the false-*exclusion*-turned-
    false-*positive* direction this module exists to avoid, since a name
    the scan fails to recover is a name that's no longer protected from
    being flagged dead. Parsing real syntax has none of that fragility.
    Only a flat literal of string constants is understood -- `BASE +
    [...]`, `tuple(...)`, `.append(...)`/`.extend(...)` all yield no
    additional names here, same "false negative is the safe failure mode"
    tradeoff as everywhere else in this module, just via `ast.Constant`
    filtering instead of a regex's blind spots."""
    if not rel_file.endswith(".py"):
        return set()
    try:
        text = (root / rel_file).read_text(encoding="utf-8")
    except OSError:
        return set()
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return set()

    names: set[str] = set()
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            targets, value = stmt.targets, stmt.value
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            targets, value = [stmt.target], stmt.value
        else:
            continue
        if not any(isinstance(t, ast.Name) and t.id == "__all__" for t in targets):
            continue
        if not isinstance(value, (ast.List, ast.Tuple, ast.Set)):
            continue
        names.update(
            element.value
            for element in value.elts
            if isinstance(element, ast.Constant) and isinstance(element.value, str)
        )
    return names


def find_dead_code_candidates(
    nodes: list[Node],
    reverse_index: dict[str, list[tuple[str, EdgeKind]]],
    *,
    root: Path,
) -> list[DeadCodeCandidate]:
    """Every `FUNCTION` node with zero inbound edges in `reverse_index`
    (built once at parse time -- see `RepoCache.set`) that survives the
    exclusion heuristics above. `root` is the parsed repo's root, needed
    only for the `__all__` source scan.
    """
    exports_by_file: dict[str, set[str]] = {}
    candidates: list[DeadCodeCandidate] = []

    for node in nodes:
        if node.kind != NodeKind.FUNCTION:
            continue
        if reverse_index.get(node.id):
            continue
        if node.has_decorators:
            continue
        if _is_dunder(node.label):
            continue
        if node.label.lower() == "main":
            continue
        if _is_test_file(node.file) or _looks_like_test_name(node.label):
            continue
        if node.file not in exports_by_file:
            exports_by_file[node.file] = _module_all_exports(root, node.file)
        if node.label in exports_by_file[node.file]:
            continue
        candidates.append(DeadCodeCandidate(node_id=node.id))

    return candidates
