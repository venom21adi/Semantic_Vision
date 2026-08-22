import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getFunctionSource, getGraph, parseRepo, saveDoc, streamDoc } from './client'

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
      } else {
        controller.close()
      }
    },
  })
}

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

  it('streamDoc POSTs the provider and yields decoded chunks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(streamFrom(['Hello', ' world']), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const chunks: string[] = []
    for await (const chunk of streamDoc('/repo', 'app.py::greet', 'ollama', 'llama3.2:3b')) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['Hello', ' world'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/generate-doc')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ provider: 'ollama', model: 'llama3.2:3b' })
  })

  it('streamDoc omits model from the body when none is given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(streamFrom(['Hi']), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    for await (const _chunk of streamDoc('/repo', 'app.py::greet', 'openai', undefined)) {
      // drain
    }

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init?.body as string)).toEqual({ provider: 'openai' })
  })

  it('streamDoc throws ApiError with the backend detail on non-2xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: 'boom' }), { status: 502 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const iterate = async () => {
      for await (const _chunk of streamDoc('/repo', 'app.py::greet', 'ollama', undefined)) {
        // never reached
      }
    }

    await expect(iterate()).rejects.toMatchObject({ status: 502, message: 'boom' })
  })

  it('saveDoc POSTs the markdown and returns the parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ node_id: 'app.py::greet', markdown: '# greet', updated_at: 'now' }),
        { status: 200 },
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await saveDoc('/repo', 'app.py::greet', '# greet')

    expect(result.markdown).toBe('# greet')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/doc')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ markdown: '# greet' })
  })
})
