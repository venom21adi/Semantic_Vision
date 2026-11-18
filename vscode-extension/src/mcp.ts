import { resolveBundledBackendPath, resolvePort } from './backend'

/** How to launch the Semantic Vision MCP server (stdio) for an agent. */
export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

/** Where the MCP server should find the backend. It reuses a backend already
 * listening there (the one this extension starts) and only spawns its own if
 * nothing answers, so an agent and the graph view share one warm cache. */
export function backendEnv(backendUrl: string): Record<string, string> {
  const url = new URL(backendUrl)
  return {
    SEMANTIC_VISION_BACKEND_HOST: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
    SEMANTIC_VISION_BACKEND_PORT: String(resolvePort(backendUrl)),
  }
}

/** The launch command for this install: the bundled binary in `--mcp` mode
 * (no Python or uv needed), or, for a contributor with a checkout configured
 * via `semanticVision.backendPath`, `uv run semantic-vision-mcp` from there.
 * `null` when neither is available. */
export function resolveMcpLaunch(
  extensionPath: string,
  backendUrl: string,
  backendPath: string,
): McpLaunch | null {
  const env = backendEnv(backendUrl)
  if (backendPath.trim()) {
    return { command: 'uv', args: ['--directory', backendPath.trim(), 'run', 'semantic-vision-mcp'], env }
  }
  const bundled = resolveBundledBackendPath(extensionPath)
  if (!bundled) return null
  return { command: bundled, args: ['--mcp'], env }
}

/** A ready-to-paste `mcpServers` block for Claude Code, Cursor and other
 * MCP clients that read a JSON config. */
export function mcpConfigSnippet(launch: McpLaunch): string {
  return JSON.stringify(
    { mcpServers: { 'semantic-vision': { command: launch.command, args: launch.args, env: launch.env } } },
    null,
    2,
  )
}

/** The one-line `claude mcp add` command for Claude Code. */
export function claudeCodeCommand(launch: McpLaunch): string {
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)
  const envFlags = Object.entries(launch.env).map(([k, v]) => `-e ${k}=${v}`)
  return ['claude mcp add semantic-vision', ...envFlags, '--', q(launch.command), ...launch.args.map(q)].join(' ')
}
