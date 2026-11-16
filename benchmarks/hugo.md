# gohugoio/hugo (Go)

[Hugo](https://github.com/gohugoio/hugo) — the static site generator, one of the most widely used
Go programs in existence — chosen as the Go benchmark for Milestone 13 (Go language support) the
same way FastAPI, nest and Guava were chosen for their languages: a real, actively maintained,
unmodified production codebase, not a synthetic benchmark repo.

Benchmarked at commit `7a15e87270b517093ecbffcae5e5610d783e476c` (2026-11-13), **full repo, no
scoping**: 914 `.go` files, 395 of them `_test.go`. Unlike webpack, three.js, or Guava, nothing
needed carving out — Hugo has no parallel source tree and no large synthetic fixture suite, and
its `vendor/` is not checked in. Hugo also contains a little JavaScript (site assets), which
language detection correctly pre-checks alongside Go; the benchmark selects **Go only**, since
mixing two languages would blur what's being measured.

## Results

| Metric | Value |
|---|---|
| Files | 914 |
| Nodes | 10,780 (8,193 functions, 1,473 classes, 914 files, 200 directories) |
| Edges | 73,947 |
| Parse errors | **0** |
| Backend parse — cold | 4.45s † |
| Backend parse — warm | 4.38–4.43s |
| Complexity index build | 3.2s |
| `POST /api/parse-repo` | 4.96–5.32s |
| `GET /api/graph` | 0.09–0.10s |
| Graph payload | 13,810 KB |
| Browser: time to data | 5.45–6.35s |
| Browser: time to render | 7.90–8.46s |

The browser numbers are the range across six consecutive runs, each from a clean state (the
`.visualiser` directory removed between runs). The backend numbers are two to four consecutive runs.

## Notes

**Zero parse errors across a real-world Go codebase**, including generics-heavy code
(`cache/dynacache` is built on `Partition[K, V]`). This is the headline result for the grammar
choice: Go is parsed with `tree-sitter-go` rather than Go's own `go/parser`, and there was a real
risk that a generic grammar would reject newer syntax. It did not.

**No cold/warm gap on this machine, unlike the other four repos.** The cold figure is the first
parse of a fresh shallow clone, as in the main methodology — but this clone had been *written to
disk seconds earlier*, so its files were still in the OS file cache and the "cold" read wasn't
actually cold. The other languages' gap (3.9x–16x) came from clones that had aged out of cache.
† Read it as a warm number; a truly cold Go figure is not published here rather than guessed.

**The complexity index (3.1–3.3s) is in the same range as the other languages** (nest 1.9s,
fastapi 2.7s) for a repo with 8,193 functions. Profiling it surfaced one avoidable cost that was
fixed as part of this benchmark: `go_locate.py` originally indexed definitions by walking every
syntax node of every file (about 1.7 million nodes on Hugo), when every Go definition that becomes a
graph node sits at the top level of its file. Indexing only top-level declarations cut the build
from ~3.6s to ~3.3s. What remains is inherent — re-parsing each file (~1s) and the cyclomatic walk
over every function body (~1.8s) — and is the same work the Java and TS paths do.

**Browser render is slightly above the other languages** (8.0–8.4s vs 4.7–7.8s), consistent with
Hugo's graph being larger than most of the set (73,947 edges; only Guava's 47,390 comes close) and
its project root being unusually wide — about 50 top-level package directories, all of which the
benchmark expands.

### What the call-graph numbers do and don't say

Of the call edges Hugo produces, **13,141 resolve to a function or type inside the repo**,
**1,438 more are linked as *ambiguous*** (see below), **15,548 resolve to an external package**
(`fmt.Println`, `strings.Join`, and so on), and **26,991 stay `unresolved`**. The unresolved ones
are overwhelmingly calls on a *local variable*, which can't be resolved without type inference —
the top targets are test helpers:

| Unresolved target | Count |
|---|---|
| `c.Assert` | 3,908 |
| `b.AssertFileContent` | 1,997 |
| `t.Parallel` | 1,168 |
| `b.Assert` | 573 |
| `t.Errorf` | 371 |

This is a documented, deliberate limit shared by every language here: an edge is left
`unresolved` rather than guessed. For Go it costs more than for Python or JS because idiomatic Go
passes everything through typed locals and interface values.

**One Go-specific rule recovers a large share of those.** Go only lets code in the *same package*
call an *unexported* method, so `c.start()` on a variable of unknown type can only target a method
named `start` in that directory. Those calls are now linked as **ambiguous** edges to every
same-package method of that name (up to 5; more than that stays unresolved), including calls on
receivers with no variable name (`x.(*T).m()`, `f().m()`), method values (`loader.F = r.resolve`),
and package-level initializers (`var cmd = &Command{Run: run}`). Exported names are never linked:
`buf.String()` could belong to any imported type. A name that is also a struct field anywhere in
the package is skipped too, since a field read or a call of a func-typed field looks identical.
An independent review sampled 34 of the resulting groups on this repo: 22 clearly right, 6 right
plus one or two extra candidates, and 2–3 wrong (all field reads, since fixed).

**What this did to dead-code detection.** The Code Health dead-code tab originally flagged **603**
of Hugo's 8,193 functions (7.4%), and spot-checking showed real false positives from exactly this
cause: `Cache.start` is called as `c.start()` on a local variable (`dynacache.go:94`), and
`Partition.adjustMaxSize` through a variable of an interface type. With the rule above, plus
function-value and package-level-initializer references, it flags **147 (1.8%)**. Checking the
leftovers by hand also caught a separate parser gap: tree-sitter-go reads a call to a generic function
with explicit type arguments (`newDispatcher[Q, R](opts)`) as a type *conversion*, so every such call
was invisible; that is fixed. What is left:

- **71 exported functions** — a library's public API has no in-repo caller by definition, and
  `main`-package targets such as Hugo's mage tasks are invoked by an outside tool.
- **71 methods**, 39 of them in three interface-method families (`tree`, `writeTo`,
  `forEeachContentNode`) with more than five implementers each, where linking every candidate would
  be noise, so they stay unresolved and look dead.
- **5 unexported functions**, each checked: two are the other side of a `go:build` pair
  (`newDeployCommand`, `syscallIsNotSupported` — two files define the same name for different
  build configurations, and only one is linked), one is an unused debug helper (`printFs`), and two
  are legacy copies kept beside their replacements (`isTrueOld`, `safeCallOld`).

Treat the tab as a list of *candidates to review*, as the dead-code documentation already says for
every language; on Go it still over-reports for interface implementations and build-tag variants, and
under-reports where an ambiguous edge protects a method that is really unused. The `ambiguous` flag is
carried on the edge, but impact analysis and the UI do not yet treat ambiguous edges differently from
definite ones, so one ambiguous call can widen a function's reported blast radius by up to five
methods.

The Go-specific resolution that *does* work and matters at this scale: **2,171 imports resolved to
local packages** via `go.mod`, versus 3,919 external — the cross-package structure of a 914-file
repo comes through.

## Browser harness fixes made for this run

Running the browser tier turned up three problems in the benchmark tooling itself, none Go-specific
and all fixed in this change:

- `frontend/scripts/benchmark-load.js` still drove the old loader (a `Language` dropdown). The
  loader has since become a three-step wizard, so it now walks path → language chips → save
  location, and sets the selection to exactly the requested language. Language detection
  pre-checks *every* language it finds, so a polyglot repo like Hugo would otherwise load several
  languages at once.
- The script treated "data received" as "tree is mounted". On a repo with many root directories
  the batch-click of root checkboxes could fire before the tree existed and click nothing,
  timing out on render — **2 of 3 runs failed intermittently** before it waited for the tree. Six
  consecutive runs pass after.
- `scripts/benchmark_repo_load.py` called `GET /api/graph` without a `language`, which 404s now
  that the repo cache is keyed per language.
