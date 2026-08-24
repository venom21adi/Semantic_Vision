# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0] - 2026-08-24

### Added

- **Multi-Language Support (Python, JavaScript, TypeScript).** A repository can
  now be parsed as JavaScript/TypeScript instead of Python — pick one from the
  language selector next to the repository path field when loading a repo.
  JS/TS parsing uses [`tree-sitter`](https://tree-sitter.github.io/tree-sitter/)
  (no Node.js toolchain required in the backend); imports and calls are
  hand-resolved into the same graph model Python's resolver produces, with
  genuinely ambiguous cases (e.g. a default import that can't be traced to
  the exact declaration it binds to) flagged rather than guessed. Covers
  `.js`/`.jsx`/`.mjs`/`.cjs`/`.ts`/`.mts`/`.cts`/`.tsx`. A repo is parsed as
  one language at a time — no mixed-language parsing within a single load.
  Known, deliberately deferred gaps: `static {}` class-initialization
  blocks, CommonJS-style `const { x } = require(...)` destructuring, and
  `tsconfig.json` path aliases (`"@/utils/x"`). Execution flowcharts, the
  complexity report, and AI documentation remain Python-only under the hood
  for now — they degrade to a minimal placeholder rather than erroring on a
  JS/TS repo.
- **Function Performance Prediction.** A cyclomatic-complexity heatmap over
  the whole graph and a ranked report of every function, with a one-click
  drill-down into a function's callers cross-referenced with their own
  scores.
- A shared `LanguageAdapter` interface (`src/semantic_vision/languages/`)
  so a language plugs into parsing, import/call resolution, and repository
  discovery as one unit — the architecture the JS/TS support above is built
  on, and what any future language would build on too.

### Changed

- The backend's Python-only parsing/resolution code was refactored behind
  the `LanguageAdapter` interface with no behavior change to existing
  Python parsing (verified by the full pre-existing test suite passing
  unmodified throughout).

## [0.1.0] - 2026-08-23

The first complete release — interactive call graph visualization, impact
analysis (upstream callers, cycle detection), AI-generated function
documentation (Ollama, OpenAI, or Anthropic), function-level execution
flowcharts, a searchable file/function tree, persisted layout and analysis
state, and Docker packaging for one-command setup. Parsing targets Python,
via its own `ast` module.
