# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- **MCP server: every tool after `parse_repo` failed for non-Python repos.** The query tools
  (`get_impact`, `get_callees`, `get_graph`, ...) had no `language` and defaulted to `python`, so
  after `parse_repo(language="go")` they answered "Repository not parsed yet for language
  'python'". The server now remembers the language each path was parsed with, and `parse_repo`
  detects it when omitted.
- **MCP server: bare function names** (`term_len`) are accepted wherever a node id is, when they
  match exactly one node; ambiguous or unknown names return candidates instead of a bare
  "Node not found". `get_callees` on an unknown id is now an error, not an empty list.
- **MCP server: large-repo parse timeout.** A cold parse of a ~900-file repo (32 s) exceeded the
  client's 30 s timeout and surfaced as an empty "Could not reach the backend"; parses now allow
  10 minutes and timeout errors name their type.

### Added

- **VS Code extension now bundles the MCP server** (extension 1.6.0). The frozen backend binary has an
  `--mcp` mode; the extension registers it with VS Code's agent where supported and adds a
  "Copy MCP Config for Your Agent" command for Claude Code, Cursor and others. It reuses the extension's
  backend. In a frozen build the MCP client starts the backend by re-running the binary.
- **Go support** at full parity with the other languages: call graph (a Go
  package is a directory, so same-package calls across files and
  `import`-ed local packages resolve via `go.mod`), methods grouped by
  receiver type, complexity, execution flowcharts (`switch`/type-switch/
  `select`, explicit `fallthrough`, labeled `break`/`continue`), AI-doc
  context, duplicates, and dead-code heuristics (`init`, `_test.go`, exported methods,
  function values, package-level initializers). Calls on variables of unknown type are linked
  to same-package *unexported* methods as ambiguous edges, since only the same package can
  call them (dead-code candidates on gohugoio/hugo: 7.4% -> 1.8%).
  Built on `tree-sitter-go` rather than the Go-subprocess helper the build
  plan originally specced, so no Go toolchain is needed anywhere.
- **Java support** at full parity with Python and JS/TS: call graph, import
  resolution, complexity scoring, execution flowcharts, and AI-doc context.
- **Code-to-Data Lineage.** SQLAlchemy model/relationship parsing,
  function-to-table read/write detection, dbt `manifest.json` ingestion, and
  read-only live database introspection, surfaced as table nodes on the graph
  and a "Connect data source" panel. See `guides/data-lineage.md`.
- **Code Health dashboard.** A full-width view (replacing the old complexity
  side pane and canvas heatmap) with ranked complexity, hotspots
  (complexity x git churn), dead-code candidates, coverage risk, duplicate
  functions, opt-in dependency/security risk (OSV), and AI-prioritized
  recommendations. Complexity can be diffed against the last look, a commit,
  or two arbitrary refs via a scratch `git worktree`.
- **MCP server** (`semantic-vision-mcp`) exposing the graph, impact analysis,
  complexity (including ref diffs), hotspots, dead code, coverage risk,
  duplicates, flowcharts, and source lookup to any MCP-compatible coding
  agent. See `guides/mcp-server.md`.
- **VS Code extension** (Marketplace, currently 1.4.2): embedded graph panel,
  click-to-jump, and a right-click Impact Analysis command; the backend ships
  as a standalone per-platform executable.
- **Repo loading wizard** (path, then languages, then save location) and
  GHCR Docker image publishing via CI.

### Changed

- Landing page and extension listing repositioned around "codebase
  observability"; graph edges now route orthogonally with an edge-kind
  legend and filter.
- Fixed an O(files x tree size) definition lookup in JS/TS parsing and a
  getter/setter node-id collision.

- **Polyglot repo support.** Loading a repo path now auto-detects every
  supported language present (Python, JavaScript/TypeScript, Java) and lets
  you select any combination via chips instead of picking exactly one. Each
  selected language is parsed and cached independently
  (`POST /api/detect-languages`, cache keys now include the language), and
  the dashboard shows one tab per loaded language with isolated graph/Code
  Health/docs state — switching tabs doesn't lose or mix up state between
  languages. No cross-language call linking yet; each tab is still an
  island.

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
