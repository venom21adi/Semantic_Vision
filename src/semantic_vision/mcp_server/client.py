"""Thin HTTP client wrapping the existing FastAPI backend -- see this
package's `__init__.py` for why this goes over HTTP rather than importing
`semantic_vision.api.routes` in-process.
"""

from __future__ import annotations

import asyncio
import atexit
import ipaddress
import subprocess
import sys
import time
from typing import Any

import httpx
from mcp.server.mcpserver.exceptions import ToolError

from semantic_vision.api.schemas import (
    ComplexityDiffResponse,
    ComplexityRefDiffResponse,
    ComplexityResponse,
    DeadCodeResponse,
    FlowchartResponse,
    FunctionSourceResponse,
    GitRefsResponse,
    GraphResponse,
    HotspotsResponse,
    ImpactResponse,
    ParseRepoResponse,
)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


class BackendError(ToolError):
    """Raised for any non-2xx backend response. Subclasses the SDK's own
    `ToolError` -- "a failure you anticipated" -- rather than a plain
    exception, so it surfaces to the calling agent as a clean
    `is_error=True` tool result with the message as content, not an
    opaque "Error executing tool X" crash. The message is the backend's
    own `detail` field -- the same text a browser user of the real app
    would see (mirrors `frontend/src/api/client.ts`'s `ApiError`), so an
    agent gets an actionable message ("Repository not parsed yet... call
    parse_repo first", "Not a git repository: ...")."""


def _extract_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text or f"HTTP {response.status_code}"
    if isinstance(body, dict) and "detail" in body:
        return str(body["detail"])
    return response.text or f"HTTP {response.status_code}"


def _is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class BackendClient:
    """One instance per MCP server process. Talks to a backend at
    `host:port` over HTTP; `ensure_running()` reuses it if already
    reachable (the common case -- the user's desktop app or VS Code
    extension already has one up, with a warm `RepoCache`) or spawns one
    itself if not, tracking that so `aclose()` only ever tears down a
    backend this instance actually started.
    """

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}"
        self._client = httpx.AsyncClient(base_url=self.base_url, transport=transport, timeout=30.0)
        self._process: subprocess.Popen[bytes] | None = None

    async def is_reachable(self) -> bool:
        try:
            response = await self._client.get("/api/health", timeout=2.0)
        except httpx.HTTPError:
            return False
        if response.status_code != 200:
            return False
        try:
            return response.json().get("status") == "ok"
        except ValueError:
            return False

    def _spawn_backend(self) -> subprocess.Popen[bytes]:
        # `ensure_running` only gets here when nothing already answers on
        # `host:port` -- refuse to spawn the full backend (every route,
        # including write-capable ones this MCP tool surface never calls,
        # e.g. `/api/dataflow/db-connection`, `/api/generate-doc`) bound
        # to a non-loopback address. Same trust boundary as a human
        # running `python main.py` themselves, but that's an explicit
        # choice; a misconfigured `SEMANTIC_VISION_BACKEND_HOST` (e.g.
        # `0.0.0.0`) triggering it as a side effect of one tool call from
        # an agent is not.
        if not _is_loopback_host(self.host):
            raise BackendError(
                f"Refusing to spawn the backend bound to non-loopback host {self.host!r} -- "
                "set SEMANTIC_VISION_BACKEND_HOST to 127.0.0.1/localhost, or start the backend "
                "yourself first if you really need it reachable elsewhere."
            )
        # `sys.executable`, not `uv run uvicorn ...` (the VS Code
        # extension's own dev-mode invocation, `backend.ts`'s
        # `spawnBackend`) -- `semantic_vision.api.app` is already
        # importable in whatever environment this MCP server itself runs
        # in (dev checkout, pip install, or `uvx`), so this works in every
        # case rather than assuming a dev checkout with `uv` on PATH.
        #
        # `stdin=DEVNULL` too, not just stdout/stderr: this MCP server's
        # own stdin *is* the JSON-RPC transport to its client (stdio mode)
        # -- without this, the spawned backend (and, transitively, every
        # git subprocess it shells out to for ref-diffing/hotspots)
        # inherits that same pipe handle. Confirmed the hard way: git
        # worktree operations against a backend spawned without this
        # intermittently died with an empty-stderr failure / the HTTP
        # connection dropping mid-response (httpcore.ReadError) -- a
        # classic symptom of a subprocess sharing a pipe handle several
        # levels up its ancestry on Windows.
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "semantic_vision.api.app:app",
                "--host",
                self.host,
                "--port",
                str(self.port),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Backup to `aclose()`: a normal interpreter exit (including an
        # unhandled `KeyboardInterrupt` propagating out of `asyncio.run`)
        # runs `atexit` handlers even when `aclose()`'s own `finally`
        # doesn't get a chance to -- narrows, doesn't eliminate, the
        # window where an abrupt exit orphans a backend this server
        # itself spawned (a hard kill of this process skips atexit too;
        # nothing running in-process can guard against that).
        atexit.register(self._terminate_process_best_effort)
        return process

    def _terminate_process_best_effort(self) -> None:
        if self._process is not None and self._process.poll() is None:
            self._process.terminate()

    async def _wait_for_backend(self, timeout_s: float = 20.0) -> None:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if await self.is_reachable():
                return
            await asyncio.sleep(0.2)
        raise BackendError(
            f"Backend at {self.base_url} did not become reachable within {timeout_s}s"
        )

    async def ensure_running(self) -> None:
        """Reuses an already-running backend if reachable; spawns one
        otherwise. Never spawns a second backend on top of one that's
        already there -- and never kills one it didn't start (see
        `aclose`).

        Benign race, not guarded against: two `BackendClient`s racing this
        call against no running backend can both observe "unreachable"
        and both spawn; the loser's own process exits (port already
        taken) while its own `is_reachable` poll then observes the
        winner's backend and reports success anyway, leaving that
        instance's `_process` pointed at a process that isn't actually
        serving anything. Harmless (`aclose` reaps a dead process fine)
        and unlikely in this single-user desktop context, not worth a
        cross-process lock for."""
        if await self.is_reachable():
            return
        self._process = self._spawn_backend()
        await self._wait_for_backend()

    async def aclose(self) -> None:
        await self._client.aclose()
        if self._process is None:
            return
        self._process.terminate()
        try:
            # `Popen.wait` is a blocking call -- run it off the event loop
            # thread rather than stalling every other in-flight tool call
            # for up to 5s while this one waits.
            await asyncio.to_thread(self._process.wait, timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        clean_params = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            response = await self._client.get(path, params=clean_params)
        except httpx.HTTPError as exc:
            raise BackendError(f"Could not reach the backend at {self.base_url}: {exc}") from exc
        if response.status_code >= 400:
            raise BackendError(_extract_detail(response))
        return response.json()

    async def _post(
        self, path: str, json_body: dict[str, Any], params: dict[str, Any] | None = None
    ) -> Any:
        clean_params = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            response = await self._client.post(path, json=json_body, params=clean_params)
        except httpx.HTTPError as exc:
            raise BackendError(f"Could not reach the backend at {self.base_url}: {exc}") from exc
        if response.status_code >= 400:
            raise BackendError(_extract_detail(response))
        return response.json()

    async def parse_repo(
        self, path: str, language: str = "python", doc_root: str | None = None
    ) -> ParseRepoResponse:
        data = await self._post(
            "/api/parse-repo", {"path": path, "language": language, "doc_root": doc_root}
        )
        return ParseRepoResponse.model_validate(data)

    async def get_graph(self, path: str) -> GraphResponse:
        data = await self._get("/api/graph", {"path": path})
        return GraphResponse.model_validate(data)

    async def get_impact(
        self, path: str, node_id: str, max_depth: int | None = None
    ) -> ImpactResponse:
        data = await self._get("/api/impact", {"path": path, "id": node_id, "max_depth": max_depth})
        return ImpactResponse.model_validate(data)

    async def get_complexity(self, path: str) -> ComplexityResponse:
        data = await self._get("/api/complexity", {"path": path})
        return ComplexityResponse.model_validate(data)

    async def get_complexity_diff(self, path: str) -> ComplexityDiffResponse:
        data = await self._get("/api/complexity/diff", {"path": path})
        return ComplexityDiffResponse.model_validate(data)

    async def get_complexity_diff_ref(
        self, path: str, ref: str, to_ref: str | None = None, language: str = "python"
    ) -> ComplexityRefDiffResponse:
        data = await self._get(
            "/api/complexity/diff-ref",
            {"path": path, "ref": ref, "to_ref": to_ref, "language": language},
        )
        return ComplexityRefDiffResponse.model_validate(data)

    async def get_hotspots(self, path: str, window_days: int = 90) -> HotspotsResponse:
        data = await self._get(
            "/api/complexity/hotspots", {"path": path, "window_days": window_days}
        )
        return HotspotsResponse.model_validate(data)

    async def get_dead_code(self, path: str) -> DeadCodeResponse:
        data = await self._get("/api/dead-code", {"path": path})
        return DeadCodeResponse.model_validate(data)

    async def get_git_refs(self, path: str) -> GitRefsResponse:
        data = await self._get("/api/git/refs", {"path": path})
        return GitRefsResponse.model_validate(data)

    async def get_flowchart(self, path: str, node_id: str) -> FlowchartResponse:
        data = await self._get("/api/flowchart", {"path": path, "id": node_id})
        return FlowchartResponse.model_validate(data)

    async def get_function_source(self, path: str, node_id: str) -> FunctionSourceResponse:
        data = await self._get("/api/function-source", {"path": path, "id": node_id})
        return FunctionSourceResponse.model_validate(data)
