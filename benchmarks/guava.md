# google/guava (Java)

[Guava](https://github.com/google/guava) — Google's core Java library, one of the most widely
used Java dependencies in existence, chosen as the Java stress test for Milestone 12 (Java
language support) the same way FastAPI/nest were chosen for Python/TypeScript: a real, actively
maintained, unmodified production codebase, not a synthetic benchmark repo.

Benchmarked at commit `7e41f72b3e84818e3b997a4bbde5851d01c67ca3` (2025-04-11), scoped to `guava/`
(615 files) — the actual JRE-targeting library source, not the full repo. Guava's own top level
also ships `android/` (a near-complete parallel source tree mirroring `guava/` for older Android
API compatibility), `guava-gwt/` (a GWT super-source overlay), `guava-testlib/`, `guava-tests/`,
and `integration-tests/`. Unlike webpack's `lib/` scoping (avoiding synthetic test fixtures) or
three.js's `src/` scoping (excluding docs/examples), this is a different kind of scoping decision:
`android/` and `guava-gwt/` are real, legitimate, shipped source — not bloat — but they're
alternate build targets for substantially the same code, and including them would more than
double the node/edge count without adding proportionally different real content, making a
same-repo cross-language comparison misleading. See [Full-repo case study](#full-repo-case-study)
below for what including everything actually looks like.

## Results

| Metric | Value |
|---|---|
| Files | 615 |
| Nodes | 14,087 |
| Edges | 47,390 |
| Parse errors | 5 |
| Backend parse — cold | 9.83s |
| Backend parse — warm | 2.52s |
| Complexity index build | 0.35–0.36s |
| `POST /api/parse-repo` | 2.14s |
| `GET /api/graph` | 0.14s |
| Graph payload | 12,994.4 KB |
| Browser: time to data | not measured — see [Browser tier note](#browser-tier-not-measured) |
| Browser: time to render | not measured — see [Browser tier note](#browser-tier-not-measured) |

## Notes

**Higher node/edge density per file than Python or JS/TS.** 615 files (roughly half FastAPI's
1,138) still produced 14,087 nodes — more than double FastAPI's 6,650 — and 47,390 edges, nearly
double FastAPI's 25,145. Not a bug: Guava's style is unusually class/method-dense per file (small,
focused utility classes, heavy use of nested builder/inner classes, extensive method-level
javadoc-documented public APIs), and every method, nested class, and call site is a real node/edge
in this project's graph model. Cache-state behavior matches every other language exactly — a real,
large cold/warm gap (9.83s → 2.52s, ~3.9x) driven by OS file-cache state, not a Java-specific cost;
see [the main README](README.md#cold-vs-warm-backend-parse-added-after-the-original-publish) for
the cross-language pattern this continues.

**5 parse errors, all one root cause, confirmed by direct inspection.** Every failure —
`Objects.java:77`, `Platform.java:83`, `Preconditions.java:162`, `Strings.java:266`,
`Verify.java:122` — is the exact same syntax construct: a JSR-308 type annotation placed directly
on a varargs array, e.g. `public static int hashCode(@Nullable Object @Nullable ... objects)`.
`tree-sitter-java` 0.23.5's grammar doesn't accept a second annotation between the element type and
the `...` token. Not a bug in this project's own extractor, which correctly detected
`tree.root_node.has_error` and reported a clean, isolated `ParseError` with the right file/line for
all 5 — exactly the "isolate, don't crash" contract every language adapter here is held to. A
future fix needs either a newer `tree-sitter-java` release or a best-effort recovery path — not
attempted here, since 5 of 615 files (99.2% success) on a narrow, specific syntax form doesn't
block real-world usability.

**A real, separate correctness bug surfaced by this benchmark, not yet fixed.** Guava's heavy use
of method overloading (multiple methods sharing a name, differing only in parameter types — routine
in real Java, essentially absent from this project's own Milestone 12 test fixtures, which never
exercised it) exposed that overloaded methods collide on the exact same graph node id. Minimal
repro:

```java
class Overloaded {
    void submit(Runnable r) { doA(); }
    void submit(String s) { doB(); }
}
```

produces two `RawFunction`s both registered as `Overloaded.java::Overloaded.submit` — confirmed via
`parse_repository` directly, not just observed as a symptom. This isn't only a rendering glitch
(React's own "duplicate key" warning is how it first surfaced, in the sidebar tree on the full-repo
run below): `resolver/symbol_table.py`'s `ModuleIndex.methods` dict is keyed on
`(class_name, method_name)` with no parameter-signature disambiguation, so the *second* overload's
node id silently overwrites the first's in the lookup index used for call resolution — a real
mis-attribution risk for any call site resolving to whichever overload happens to be registered
last, not necessarily the one actually being called. JS/Python don't hit this (Python has no
same-name-multiple-methods concept; TS's overload signatures compile to one implementation), so
this is a genuinely new, Java-specific gap. Not fixed in this pass: a proper fix needs a real
design decision on how to disambiguate (e.g. encoding an arity/parameter-type suffix into the
node id for overloaded methods specifically) without touching the shared, language-agnostic id
scheme `resolver/symbol_table.py` uses for every language today — the same "don't touch the shared
resolver" constraint Milestone 12 itself was built under. Flagged here as a confirmed, root-caused
finding for a deliberate follow-up, not silently worked around.

### Browser tier: not measured

The Playwright browser-tier benchmark (`frontend/scripts/benchmark-load.js`) did not complete this
session for *any* repo, including a sanity-check re-run of the previously-reliable "medium" (this
project's own repo) case — ruling out a Java-specific cause. This is a benchmark-harness/
environment issue in this specific session, not a finding about app behavior, and is recorded
here as an honest gap rather than a fabricated or guessed number.

### Full-repo case study

Pointing Semantic Vision at the *entire* `google/guava` repo as cloned (3,267 files — `guava/`,
`android/`, `guava-gwt/`, `guava-testlib/`, `guava-tests/`, `integration-tests/`, everything)
produces a dramatically larger graph: **64,713 nodes, 371,567 edges, 13 parse errors** (the same 5
root causes as above, appearing again in `android/`'s mirrored copies), backend parse **78.81s
cold / 16.47s warm**, `POST /api/parse-repo` **17.13s**, and a **106,001.7 KB (~106 MB)** graph
payload — roughly 8-20x every other repo in this comparison, including the scoped `guava/` entry
above. That payload size is large enough that the browser-tier benchmark never received data
within a 300-second timeout even before this session's separate harness issue was identified —
a real, worth-noting scaling data point in its own right: a ~106 MB single JSON graph payload is
a genuinely different regime than anything else benchmarked in this folder (the next-largest,
nest's, is 6 MB). Kept out of the main table above for the same reason webpack's unscoped `lib/`
run was kept as a case study rather than the headline JavaScript number: it would skew a
same-scale cross-language comparison with a structural fact (Guava ships multiple parallel source
trees for the same code) rather than a Java-specific cost.
