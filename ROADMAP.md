# Semantic Vision — Product Roadmap

**Status:** V1 shipped. This document describes what's already delivered and what's planned
next. It's a living document, not a committed schedule — dates aren't given because this is
scoped and re-prioritized as it's built, not shipped against a fixed deadline.

## Overview

Semantic Vision turns a codebase into something you can actually see and reason about: a live
call graph, upstream impact analysis, per-function execution flowcharts, and AI-generated
documentation, all running locally against your own source. The problem it solves is the time
engineers lose reconstructing a mental model of code they didn't write — reading files one at a
time, grepping for callers, guessing at blast radius before a change. V1 targets a single
engineer working against a single local Python repository. V2 widens that in five directions:
richer signal on the existing graph, support for the other languages real codebases are
actually written in, a shared view for a whole team instead of one engineer at a time, a
presence inside the editor instead of a separate browser tab, and a connection from that graph
down into the data layer the code actually reads and writes.

## Current release: V1

All eight planned V1 capabilities are complete and in use.

| Capability | Delivers |
|---|---|
| Interactive call graph | The full structure of a repository — directories, files, classes, functions, and how they call, import, and define each other — as one explorable diagram. |
| Searchable structure tree | Instant navigation to any file or function by name, or a scoped view of just one file's own structure. |
| Impact analysis | For any function, every direct and transitive caller, with circular call chains flagged rather than silently mishandled — the actual blast radius of a change, not a guess. |
| Execution flowcharts | A function's real control flow — branches, loops, I/O, calls to other functions — rendered as a standard flowchart, built from its AST rather than summarized. |
| AI-generated documentation | Markdown documentation for any function, generated from its real source and call context, via a local model or a cloud provider, saved back into the repo. |
| Persistent layout & state | Work is never lost between sessions — layout, saved docs, and analysis state restore automatically. |
| Docker packaging | The full stack starts with one command, with a documented, safe convention for pointing it at a real codebase. |

**Quality bar:** every V1 milestone shipped with automated test coverage (108 backend / 136
frontend tests as of this release) and at least one round of independent adversarial review
before being considered done — five of the eight milestones had real defects caught and fixed
by that process before shipping, not zero.

## What's next: V2

Five initiatives, each independently useful — none blocks the others except where noted.

### Function Performance Prediction

**Problem.** The graph shows what calls what, but not what's expensive or risky to change. An
engineer still has to read a function to know whether it's simple or a tangle of branches worth
avoiding.

**Opportunity.** A complexity signal, visible directly on the graph, turns "which functions
should I be careful with" from a guess into something you can see at a glance — useful for
prioritizing refactors, code review attention, and test coverage before an incident forces the
question.

**Scope at a glance:** a complexity score per function; a color-coded heatmap overlay on the
existing graph; a ranked report of the highest-complexity functions in a repository; drill-down
into what's driving any one function's score.

**Status:** Planned. No dependency on the other three initiatives — the smallest, most
self-contained piece of this roadmap, and reuses infrastructure the execution-flowchart feature
already built.

### Multi-Language Support

**Problem.** Real engineering teams don't work in one language. A tool that only understands
Python misses most of a typical stack, which limits it to a fraction of the codebases it could
otherwise help with.

**Opportunity.** The same call graph, impact analysis, execution flowcharts, and AI
documentation — for JavaScript/TypeScript, Java, and Go, not just Python — without becoming a
different tool per language. V1 was deliberately architected so this is an extension, not a
rewrite: the graph, API, and storage layers already don't know or care what language produced
them.

**Scope at a glance:** language support added one at a time (JavaScript/TypeScript, then Java,
then Go); every existing V1 feature works unchanged for each newly-supported language, since
none of them are language-specific under the hood.

**Status:** Planned. The largest single initiative on this roadmap — before any language is
added, a shared parsing interface has to be carved out of what's currently Python-only
internals, so that piece of groundwork comes first and unblocks everything after it.

### Team Collaboration Mode

**Problem.** Semantic Vision today is single-player: every engineer runs their own local copy
with their own saved layout, their own generated docs. None of that understanding is shared —
two engineers looking at the same function build the same context from scratch, independently.

**Opportunity.** One shared, attributed view of the codebase a whole team builds up together
over time, plus a way to see what actually changed structurally between two points in the
repo's history — turning individual, disposable understanding into a team asset.

**Scope at a glance:** shared annotations on any function, attributed to whoever wrote them;
a side-by-side structural comparison between two commits or branches, showing what was added,
removed, or changed; one-click sharing of a function's documentation to Slack or Teams.

**Status:** Planned. Requires moving the storage layer from local files to something that
supports multiple people writing to it safely at once — a real but contained piece of
groundwork, done as its own step before any collaboration feature is built on top of it. Note:
"attribution" here means a name on a note, not a login system — this isn't adding
authentication or access control, by design.

### VS Code Extension

**Problem.** Checking the graph today means switching out to a browser tab, which breaks flow
while actively writing code.

**Opportunity.** The graph, impact analysis, and flowcharts available as a panel inside the
editor itself — click a node to jump straight to that code, or check what a function's change
would affect without leaving your cursor.

**Scope at a glance:** an embedded graph panel centered on whatever file is open; click-to-jump
from a graph node to its exact location in the editor; a right-click "Impact Analysis" command
available directly on a function in the code, not just on the graph.

**Status:** Planned. Independent of the other three initiatives and buildable in parallel with
any of them — it's a new surface for the existing product, not a change to the product itself.

### Code-to-Data Lineage

**Problem.** The graph today stops at the boundary of the application code. A schema change —
dropping a column, renaming a table — has real blast radius into the Python functions that read
or write it and into any dbt models built on top of it, but nothing connects those two pictures.
An engineer has to check the codebase and a separate dbt lineage graph by hand, and often doesn't
think to check both.

**Opportunity.** Extend the existing graph and impact-analysis engine — already built to answer
"what calls this function" — with the data layer: database tables, SQLAlchemy models, and dbt
models, so one click on a table surfaces every consumer in code and in the data pipeline
together. This deliberately doesn't compete with dbt's own lineage tooling or a database GUI on
their own turf — it ingests what they already produce and connects it to the code graph, which
neither shows on its own.

**Scope at a glance:** SQLAlchemy model and relationship parsing, extending the existing Python
parser rather than adding a new one; read-only, local schema introspection against on-prem
databases as ground truth; ingestion of dbt's own `manifest.json` lineage output — no SQL
parsing or reimplementation of dbt's DAG; detection of which functions read or write which
tables, via ORM calls and (table-level only) raw SQL query text; impact analysis extended to
traverse across code and data in one view.

**Status:** Planned. No dependency on the other four initiatives — SQLAlchemy parsing builds
directly on the existing Python parser, and the dbt/database pieces are self-contained
connectors into the same graph.

## Sequencing

No initiative here blocks another except where stated above (multi-language needs its parsing
groundwork first; collaboration needs its storage groundwork first). Given that, Performance
Prediction is the natural first pick — it's the smallest, lowest-risk, and builds most directly
on what V1 already shipped — but nothing above is committed to a specific order beyond that.
Code-to-Data Lineage is similarly unblocked and could be picked up alongside it.

## Explicitly not planned

To keep scope honest: this roadmap does not include a hosted/SaaS version, user authentication
or access control, or a general-purpose plugin system for arbitrary third-party integrations.
Team Collaboration Mode's "attribution" is a display name, not an identity system — see above.
Code-to-Data Lineage does not include a SQL query optimizer or performance analyzer,
column-level lineage through raw SQL (table-level only), any ability to write to or migrate a
connected database (introspection is read-only), or a replacement for dbt's own lineage graph
(it ingests dbt's manifest rather than reimplementing dbt's own DAG engine). If any of this
changes, this document will say so explicitly rather than by omission.

## Feedback

This roadmap reflects current thinking, not a locked plan. If a use case here doesn't match how
you'd actually use the tool, or something's missing, open an issue — see the Contributing
section in [README.md](README.md).
