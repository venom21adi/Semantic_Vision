import { spawn, type ChildProcess } from 'child_process'

/** The port to spawn `uvicorn` on, parsed from the configured backend
 * URL. `URL.port` is the empty string when the port equals the scheme's
 * default (`http://localhost:80` -> `''`, per the WHATWG URL spec) --
 * naively falling back to a hardcoded default there (e.g. `port || 8000`)
 * would silently bind port 8000 instead of the port actually configured.
 * Falls back to the scheme's real default port only when none is given
 * at all (`http://localhost` -> 80). */
export function resolvePort(backendUrl: string): number {
  const url = new URL(backendUrl)
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

/** `GET /api/health` (`src/semantic_vision/api/routes.py`) already exists
 * for exactly this purpose (Docker/compose healthchecks) -- reused as-is,
 * no new backend endpoint. */
export async function isBackendReachable(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Starts the backend from `backendPath` (a Semantic Vision checkout --
 * the directory containing `pyproject.toml`), matching the project's own
 * documented local dev command exactly (`README.md`'s Quick Start):
 * `uv run uvicorn semantic_vision.api.app:app --port <port>`. Requires
 * `uv` on PATH and a prior `uv sync` in that checkout, the same
 * prerequisite as running the project manually -- this does not attempt
 * to bundle or install a Python runtime.
 *
 * `onError` is required, not optional: `ChildProcess` is an
 * `EventEmitter`, and if the spawn itself fails (no `uv` on PATH, a
 * `backendPath` that doesn't exist) with zero `'error'` listeners
 * attached, Node throws an *unhandled* exception in the extension host
 * instead of a catchable failure -- the single most likely real-world
 * misconfiguration for this exact feature, so it can't be left
 * unhandled. Without this, the only visible symptom would be a generic
 * "still isn't reachable" message 15 seconds later, with no indication
 * of the actual cause.
 */
export function spawnBackend(
  backendPath: string,
  port: number,
  onError: (error: Error) => void,
): ChildProcess {
  const child = spawn('uv', ['run', 'uvicorn', 'semantic_vision.api.app:app', '--port', String(port)], {
    cwd: backendPath,
    shell: process.platform === 'win32',
  })
  child.on('error', onError)
  return child
}

/** Polls `isBackendReachable` until it succeeds or `attempts` is
 * exhausted -- gives a freshly-spawned `uvicorn` process time to finish
 * starting up before giving up on it. */
export async function waitForBackend(
  baseUrl: string,
  attempts = 15,
  intervalMs = 1000,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isBackendReachable(baseUrl, 1000)) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}
