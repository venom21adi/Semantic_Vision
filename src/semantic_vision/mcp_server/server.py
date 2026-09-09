"""MCP tool definitions -- one thin wrapper per `BackendClient` method,
plus `get_callees` (a small, explicitly-flagged addition beyond pure 1:1
wrapping -- see its own docstring) and `get_graph`'s truncation guard (see
its own docstring). Every tool requires `parse_repo` to have been called
first for that `path`, exactly like the REST API today -- no tool
silently auto-parses on a cache miss.
"""

from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import MCPServer

from semantic_vision.mcp_server.client import BackendClient

DEFAULT_MAX_GRAPH_NODES = 500


def build_server(client: BackendClient) -> MCPServer:
    mcp = MCPServer(
        name="semantic-vision",
        instructions=(
            "Structural facts about a parsed codebase -- call graph, impact analysis, "
            "complexity, and git-history-aware hotspot/diff scoring -- computed once via "
            "static analysis, not guessed from grepping. Call parse_repo first for a given "
            "path; every other tool needs that repo already parsed. Prefer a targeted tool "
            "(get_impact, get_callees, get_function_source) over get_graph for a single "
            "function -- get_graph returns the whole repo's structure and is meant for "
            "building an initial mental model, not answering a question about one function."
        ),
    )

    @mcp.tool()
    async def parse_repo(
        path: str, language: str = "python", doc_root: str | None = None
    ) -> dict[str, Any]:
        """Parses a repository at `path` (an absolute filesystem path) and
        caches the result server-side. Required before calling any other
        tool for this `path` -- they all 404 with a clear message
        otherwise. Re-parsing an already-parsed path picks up on-disk
        changes since the last parse (e.g. after an edit)."""
        result = await client.parse_repo(path, language=language, doc_root=doc_root)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_graph(path: str, max_nodes: int = DEFAULT_MAX_GRAPH_NODES) -> dict[str, Any]:
        """Returns the full parsed structure of `path`: every node
        (directories, files, classes, functions, and -- if dbt/DB data
        was ingested -- tables/columns/dbt models) and every edge between
        them (calls, imports, containment, and lineage edges like
        foreign_key/references/materializes). This is a whole-repo dump,
        not a targeted query -- prefer get_impact/get_callees/
        get_function_source when the question is about one specific
        function. Truncated to `max_nodes` nodes (and only the edges
        between kept nodes) if the repo has more than that, to avoid
        flooding context with a repo-sized payload the same way the
        desktop app's own graph view already guards against for a large
        repo."""
        graph = await client.get_graph(path)
        total_node_count = len(graph.nodes)
        truncated = total_node_count > max_nodes
        nodes = graph.nodes[:max_nodes] if truncated else graph.nodes
        kept_ids = {node.id for node in nodes}
        edges = [e for e in graph.edges if e.source in kept_ids and e.target in kept_ids]
        return {
            "nodes": [n.model_dump(mode="json") for n in nodes],
            "edges": [e.model_dump(mode="json") for e in edges],
            "truncated": truncated,
            "total_node_count": total_node_count,
        }

    @mcp.tool()
    async def get_impact(path: str, id: str, max_depth: int | None = None) -> dict[str, Any]:
        """Upstream blast-radius for node `id`: every function/table that
        (directly or transitively, up to `max_depth`) depends on it --
        i.e. what would be affected by changing or removing it. For the
        opposite direction (what `id` itself calls), use get_callees."""
        result = await client.get_impact(path, id, max_depth=max_depth)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_callees(path: str, id: str) -> dict[str, Any]:
        """The direct functions `id` itself calls (the opposite direction
        from get_impact, which only ever reports upstream callers). Not a
        separate backend analysis -- derived by filtering the same call
        graph get_graph returns down to `id`'s own outgoing `calls`
        edges, so it stays cheap and consistent with what the desktop
        app's own call-graph view shows for the same node."""
        graph = await client.get_graph(path)
        nodes_by_id = {node.id: node for node in graph.nodes}
        callee_ids = [
            edge.target for edge in graph.edges if edge.kind == "calls" and edge.source == id
        ]
        callees = [
            {
                "id": callee_id,
                "label": nodes_by_id[callee_id].label,
                "file": nodes_by_id[callee_id].file,
            }
            for callee_id in callee_ids
            if callee_id in nodes_by_id
        ]
        return {"target": id, "callees": callees}

    @mcp.tool()
    async def get_complexity(path: str) -> dict[str, Any]:
        """Per-function cyclomatic complexity, call-chain depth, and a
        nested-loop flag for every function in `path`."""
        result = await client.get_complexity(path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_complexity_diff(path: str) -> dict[str, Any]:
        """Compares `path`'s current complexity against whatever it was
        the last time this tool (or the desktop app's dashboard) computed
        complexity for this path -- added/removed/changed functions since
        that last look. `available: false` if there's no earlier snapshot
        yet. For comparing against a specific commit/branch instead, use
        get_complexity_diff_ref."""
        result = await client.get_complexity_diff(path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_complexity_diff_ref(
        path: str, ref: str, to_ref: str | None = None, language: str = "python"
    ) -> dict[str, Any]:
        """Scores a change, not just a snapshot: diffs `ref`'s complexity
        against either the repo's current on-disk state (`to_ref` omitted
        -- e.g. "did my session's edit make this better or worse than
        main") or a second arbitrary ref (`to_ref` given -- "what did this
        commit/PR do to code health"). Checks out each ref into a scratch
        git worktree; never touches the real working tree."""
        result = await client.get_complexity_diff_ref(path, ref, to_ref=to_ref, language=language)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_hotspots(path: str, window_days: int = 90) -> dict[str, Any]:
        """Ranks functions by cyclomatic complexity x how often their
        file changed in git history over the last `window_days` -- a
        moderately complex function edited constantly is a bigger
        practical risk than a complex one nobody touches. `is_git_repo:
        false` if `path` isn't a git repository (not an error -- just no
        churn signal available)."""
        result = await client.get_hotspots(path, window_days=window_days)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_dead_code(path: str) -> dict[str, Any]:
        """Functions with zero callers anywhere in `path`'s call graph,
        after excluding decorated functions (route handlers, fixtures,
        DI-injected constructors), test files/names, dunder methods, and
        `main` entry points -- see the REST API's own
        docs/ideas/REPO-INTELLIGENCE-IDEAS.md for the full heuristic list.
        Candidates to review, not a verdict: a real caller outside this
        repo (a library's public API, a framework this tool doesn't
        recognize) can still exist."""
        result = await client.get_dead_code(path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def ingest_coverage(path: str, coverage_path: str) -> dict[str, Any]:
        """Ingests a coverage.py XML or lcov report (`coverage_path`,
        produced by the user's own test-runner -- this tool never runs
        tests itself) for the already-parsed repo at `path`. Required once
        before get_coverage_risk returns real data; re-ingest after
        significant source changes, since a function's line range can
        shift and this ingest is tied to the ranges at ingest time."""
        result = await client.ingest_coverage(path, coverage_path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_coverage_risk(path: str) -> dict[str, Any]:
        """Ranks functions by complexity x (1 + upstream blast radius) x
        (1 - test coverage) -- combines three numbers no other single tool
        here reports together, to answer "where's the real correctness
        risk" rather than complexity or blast radius alone.
        `available: false` until ingest_coverage has been called at least
        once for this path since its last parse."""
        result = await client.get_coverage_risk(path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_duplicates(path: str) -> dict[str, Any]:
        """Groups functions whose normalized AST shape hashes identically
        -- every identifier name, literal value, and comment stripped, so
        a copy-pasted-then-lightly-renamed function still gets flagged.
        Exact-shape matching only (not a similarity/near-miss threshold):
        two functions with any real structural difference won't group.
        A maintenance-cost signal complexity alone can't see -- two
        individually "simple" functions can still be costly duplication
        together."""
        result = await client.get_duplicates(path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_git_refs(path: str) -> dict[str, Any]:
        """Local branches and recent commits for `path`, for picking a
        `ref`/`to_ref` to pass to get_complexity_diff_ref."""
        result = await client.get_git_refs(path)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_flowchart(path: str, id: str) -> dict[str, Any]:
        """Execution-flow (control-flow graph) breakdown of function
        `id`'s own body -- branches, loops, and early returns as a flow
        of statement nodes, distinct from get_impact/get_callees which
        describe cross-function call relationships rather than what
        happens inside one function."""
        result = await client.get_flowchart(path, id)
        return result.model_dump(mode="json")

    @mcp.tool()
    async def get_function_source(path: str, id: str) -> dict[str, Any]:
        """The exact source text of function (or file) node `id`, read
        directly from disk by its recorded line range -- for reading one
        specific function without grepping for it."""
        result = await client.get_function_source(path, id)
        return result.model_dump(mode="json")

    return mcp
