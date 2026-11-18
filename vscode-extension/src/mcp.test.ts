import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { backendEnv, claudeCodeCommand, mcpConfigSnippet, resolveMcpLaunch } from './mcp'

function installWithBinary(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sv-ext-'))
  mkdirSync(path.join(dir, 'bin'))
  const name = process.platform === 'win32' ? 'semantic-vision-backend.exe' : 'semantic-vision-backend'
  writeFileSync(path.join(dir, 'bin', name), '')
  return dir
}

describe('backendEnv', () => {
  it('points the MCP server at the configured backend, mapping localhost to loopback', () => {
    expect(backendEnv('http://localhost:8000')).toEqual({
      SEMANTIC_VISION_BACKEND_HOST: '127.0.0.1',
      SEMANTIC_VISION_BACKEND_PORT: '8000',
    })
  })

  it('keeps a non-default port', () => {
    expect(backendEnv('http://127.0.0.1:9123').SEMANTIC_VISION_BACKEND_PORT).toBe('9123')
  })
})

describe('resolveMcpLaunch', () => {
  it('uses the bundled binary in --mcp mode when there is no checkout configured', () => {
    const dir = installWithBinary()
    const launch = resolveMcpLaunch(dir, 'http://localhost:8000', '')
    expect(launch?.args).toEqual(['--mcp'])
    expect(launch?.command).toContain('semantic-vision-backend')
  })

  it('uses uv run semantic-vision-mcp when a checkout is configured', () => {
    const launch = resolveMcpLaunch('/nowhere', 'http://localhost:8000', 'C:/src/sv')
    expect(launch).toMatchObject({ command: 'uv', args: ['--directory', 'C:/src/sv', 'run', 'semantic-vision-mcp'] })
  })

  it('returns null with neither a binary nor a checkout', () => {
    expect(resolveMcpLaunch(mkdtempSync(path.join(tmpdir(), 'sv-empty-')), 'http://localhost:8000', '')).toBeNull()
  })
})

describe('config output', () => {
  const launch = { command: 'C:/x y/sv.exe', args: ['--mcp'], env: { SEMANTIC_VISION_BACKEND_PORT: '8000' } }

  it('renders an mcpServers block', () => {
    const parsed = JSON.parse(mcpConfigSnippet(launch))
    expect(parsed.mcpServers['semantic-vision']).toEqual(launch)
  })

  it('renders a claude mcp add command with the path quoted', () => {
    const cmd = claudeCodeCommand(launch)
    expect(cmd).toBe('claude mcp add semantic-vision -e SEMANTIC_VISION_BACKEND_PORT=8000 -- "C:/x y/sv.exe" --mcp')
  })
})
