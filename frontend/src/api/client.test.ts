import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getFunctionSource, getGraph, parseRepo } from './client'

const originalFetch = globalThis.fetch

describe('api client', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parseRepo POSTs the path and returns the parsed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ path: '/repo', node_count: 1, edge_count: 0, parse_errors: [] }),
          { status: 200 },
        ),
      )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await parseRepo('/repo')

    expect(result.node_count).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/parse-repo')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ path: '/repo' })
  })

  it('getGraph GETs with the path query-encoded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ nodes: [], edges: [] }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await getGraph('/some path/with spaces')

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain(encodeURIComponent('/some path/with spaces'))
  })

  it('throws ApiError with the backend detail message on non-2xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Function not found: x' }), { status: 404 }),
      )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(getFunctionSource('/repo', 'x')).rejects.toMatchObject({
      status: 404,
      message: 'Function not found: x',
    })
  })

  it('rejects with an ApiError instance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(parseRepo('/bad')).rejects.toBeInstanceOf(ApiError)
  })
})
