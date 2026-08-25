import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBackendReachable, resolvePort, spawnBackend, waitForBackend } from './backend'

const fakeChild = { on: vi.fn() }
vi.mock('child_process', () => ({ spawn: vi.fn(() => fakeChild) }))

const originalFetch = globalThis.fetch

describe('isBackendReachable', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns true when the health endpoint responds ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as typeof fetch

    expect(await isBackendReachable('http://localhost:8000')).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/health',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('returns false when the health endpoint responds with an error status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 })) as typeof fetch

    expect(await isBackendReachable('http://localhost:8000')).toBe(false)
  })

  it('returns false when the request throws (connection refused)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch

    expect(await isBackendReachable('http://localhost:8000')).toBe(false)
  })
})

describe('resolvePort', () => {
  it('returns the explicit port from the URL', () => {
    expect(resolvePort('http://localhost:8123')).toBe(8123)
  })

  it('does not fall back to a hardcoded default when the URL uses the scheme default port', () => {
    // `http://localhost:80` -- URL.port is '' here (80 is http's default
    // port per the WHATWG spec), which a naive `Number(port || '8000')`
    // would misread as "no port given" and silently resolve to 8000.
    expect(resolvePort('http://localhost:80')).toBe(80)
  })

  it('falls back to the scheme default when no port is given at all', () => {
    expect(resolvePort('http://localhost')).toBe(80)
    expect(resolvePort('https://localhost')).toBe(443)
  })
})

describe('spawnBackend', () => {
  it('runs the documented uv/uvicorn command from the configured backend path', async () => {
    const { spawn } = await import('child_process')
    const onError = vi.fn()

    spawnBackend('/checkout/semantic-vision', 8123, onError)

    expect(spawn).toHaveBeenCalledWith(
      'uv',
      ['run', 'uvicorn', 'semantic_vision.api.app:app', '--port', '8123'],
      expect.objectContaining({ cwd: '/checkout/semantic-vision' }),
    )
  })

  it('attaches the given error handler to the spawned process, so a failed spawn is never unhandled', () => {
    const onError = vi.fn()

    spawnBackend('/checkout/semantic-vision', 8123, onError)

    expect(fakeChild.on).toHaveBeenCalledWith('error', onError)
  })
})

describe('waitForBackend', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns true as soon as the backend becomes reachable', async () => {
    let calls = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      calls += 1
      return Promise.resolve(new Response('{}', { status: calls < 3 ? 500 : 200 }))
    }) as typeof fetch

    const reachable = await waitForBackend('http://localhost:8000', 5, 1)

    expect(reachable).toBe(true)
    expect(calls).toBe(3)
  })

  it('gives up and returns false after exhausting all attempts', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 })) as typeof fetch

    const reachable = await waitForBackend('http://localhost:8000', 3, 1)

    expect(reachable).toBe(false)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })
})
