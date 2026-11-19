# Adding a language

How a language is added to Semantic Vision, and the bar it has to clear before
it ships. C# followed exactly this; [guides/csharp.md](csharp.md) is the worked
example and `scripts/csharp/` has the tooling it produced.

The shape of the work is the same for every language, because the graph model is
language-neutral: a `LanguageAdapter` turns files into `RawModule`s, the shared
symbol table turns those into nodes, and the adapter's resolver turns call sites
into edges. Everything after that (impact, Code Health, flowcharts, AI docs, the
UI) reads the graph and the source, not the language.

## 1. Spike first (a day, not a week)

Before writing the adapter, measure whether the language *can* be resolved well.

- Install the tree-sitter grammar and parse two or three well-known repositories.
- Write a throwaway script that resolves call sites by name only, then with the
  evidence the language really offers (declared types, imports, inheritance).
- Get the compiler or language server's own answer for the same sites. If a
  typed approach cannot get far past name matching, say so before building.

The C# spike found the three things that shaped the build: files with
`#if` blocks that the grammar mishandles, `using` importing namespaces rather
than types, and extension methods.

## 2. Build the adapter

| Piece | Where | Notes |
|---|---|---|
| Grammar dependency | `pyproject.toml`, `uv lock` | The frozen backend and Docker pick it up from here. |
| Extractor | `parser/<lang>_extractor.py` | Purely syntactic, per file. Never resolve across files here. Use a tree-sitter **query** for traversal, not a Python walk over every node: that walk was the dominant extraction cost on large repositories. |
| Resolver | `resolver/<lang>_*.py` | Cross-file. Honest outputs: `external::` for a known library, `unresolved::` (ambiguous) for unknown, several ambiguous edges rather than one guess. |
| Adapter | `languages/<lang>.py`, registered in `languages/registry.py` | `bind_root` gives each parse fresh per-repository state; `post_parse` runs once all files are parsed. |
| Locator | `<lang>_locate.py` | Graph node back to its tree-sitter node. Re-parse with the *same* preprocessing the extractor used, or line numbers drift. |

If the language needs facts the shared dataclasses lack, put them in
`RawModule.lang_data` / `RawClass.lang_data` / `RawFunction.lang_data` (opaque to
the shared pipeline) instead of changing the shared models.

## 3. Wire the features that read source

Each of these dispatches on file extension; add the language to each:

- `analysis/complexity.py` (cyclomatic complexity, nested loops)
- `analysis/duplicates.py`
- `analysis/dead_code.py` (test-file conventions, framework-invoked markers)
- `ai/context.py` (signature rendering, code-fence language, fallback signature)
- `flowchart/cfg.py` + `flowchart/<lang>_cfg.py`

Then the frontend: the language label in `RepoLoader.tsx` and a highlight.js
grammar in `highlightSource.ts`. The MCP server and the language chips pick the
language up from the registry.

Packaging: data files the resolver reads at runtime must be collected in
`scripts/pyinstaller/backend.spec` (PyInstaller only follows imports), and the
CI workflow's frozen-binary smoke test should parse a fixture in the new language.

## 4. Tests: reproducible, and checked against ground truth

- A **fixture repository** that exercises what makes the language hard
  (`tests/fixtures/<lang>_repo`), with expectations pinned in a resolution test.
- Unit tests for the extractor and any preprocessing.
- Tests for every source-reading feature above (locate, complexity, flowchart,
  signature, dead-code heuristics).
- A **ground-truth oracle**: the language's own compiler or analyzer reporting what
  each call resolves to, and a script comparing it to ours
  (`scripts/csharp/validate.py` is the template). Opt-in in CI if it needs an SDK,
  but the fixture must pass it. A fixture that disagrees with the compiler is
  wrong, whatever our resolver says.

## 5. Validate on real code, with a hold-out

- Pick 3 to 4 real repositories of different character, pin their commits.
- Tune on some; **hold others out** and never look at their misses while tuning.
  The held-out numbers are the honest ones, and the gap to the tuned numbers tells
  you how much was overfitting.
- Report recall and precision separately: a resolver that answers rarely and
  correctly is a different product from one that answers often and sometimes wrongly.
- Read the *misses*, not just the percentage. The biggest wins in C# came from
  sampling failures (a grammar bug that dropped whole files, decoy same-named types
  in unrelated projects), not from tuning a heuristic.

## 6. Performance

Run `scripts/benchmark_repo_load.py --language <lang>` on a repository of at least
a million lines, and profile before optimizing. Record parse time, Code Health
index time and peak memory in the language's guide. Remember that the first read of
files on a machine with antivirus can dominate; the shared pipeline reads files on
a thread pool for that reason.

## 7. Document and release

- A guide in `guides/` that says what is understood, the measured accuracy with
  pinned commits and how to reproduce it, the performance table, and the limits.
  State the limits as plainly as the strengths.
- README feature matrix and language lists, the VS Code extension README,
  the landing page, and the CHANGELOG.
- Extension release (version bump, `vscode-v*` tag) and the Docker image rebuild from
  the same commit, so every channel carries the same language set.
