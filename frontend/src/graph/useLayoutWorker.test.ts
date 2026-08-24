import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphEdge, GraphNode } from '../api/types'

/** Stands in for the real Worker in jsdom (which has none) so this file can
 * exercise `useLayoutWorker`'s actual worker-protocol logic -- job posting,
 * supersession/termination, stale-message discarding, error handling --
 * none of which the rest of the suite covers, since every other test runs
 * under the `typeof Worker === 'undefined'` synchronous fallback path. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  posted: unknown[] = []

  constructor() {
    spawnedWorkers.push(this)
  }

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }
}

let spawnedWorkers: FakeWorker[] = []

vi.mock('./layout.worker?worker', () => ({ default: FakeWorker }))

function node(id: string): GraphNode {
  return { id, kind: 'function', label: id, file: 'a.py', line_start: 1, line_end: 1 }
}

function edge(source: string, target: string): GraphEdge {
  return { source, target, kind: 'calls', external: false, ambiguous: false }
}

describe('useLayoutWorker', () => {
  let useLayoutWorker: typeof import('./useLayoutWorker').useLayoutWorker

  // `hasWorker` in useLayoutWorker.ts is a module-level const read once at
  // import time -- the global `Worker` must be stubbed, and the module
  // freshly imported, before each test.
  beforeEach(async () => {
    spawnedWorkers = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.resetModules()
    ;({ useLayoutWorker } = await import('./useLayoutWorker'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts a minimal layout request and applies returned positions without double-offsetting', async () => {
    const graphA = { nodes: [node('a'), node('b')], edges: [edge('a', 'b')] }
    const { result } = renderHook(({ graph }) => useLayoutWorker(graph), {
      initialProps: { graph: graphA },
    })

    await waitFor(() => expect(spawnedWorkers.length).toBe(1))
    const worker = spawnedWorkers[0]
    expect(worker.posted).toHaveLength(1)
    const request = worker.posted[0] as {
      jobId: number
      direction: string
      nodeIds: string[]
      edges: { source: string; target: string }[]
    }
    // Only ids and source/target pairs cross the postMessage boundary --
    // never label/kind/file/style, which layout never reads.
    expect(request).toEqual({
      jobId: expect.any(Number),
      direction: 'TB',
      nodeIds: ['a', 'b'],
      edges: [{ source: 'a', target: 'b' }],
    })

    act(() => {
      worker.onmessage?.({
        data: {
          jobId: request.jobId,
          positions: [
            { id: 'a', x: 10, y: 20 },
            { id: 'b', x: 30, y: 40 },
          ],
        },
      } as MessageEvent)
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    // layoutGraph (run inside the real worker) already returns final,
    // node-size-adjusted positions -- the hook must not offset them again.
    expect(result.current.nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 10, y: 20 })
  })

  it('does not report the old scope as ready once scopedGraph has changed, even before a new response arrives', async () => {
    const graphA = { nodes: [node('a')], edges: [] }
    const graphB = { nodes: [node('b')], edges: [] }
    const { result, rerender } = renderHook(({ graph }) => useLayoutWorker(graph), {
      initialProps: { graph: graphA },
    })

    await waitFor(() => expect(spawnedWorkers.length).toBe(1))
    const firstRequest = spawnedWorkers[0].posted[0] as { jobId: number }
    act(() => {
      spawnedWorkers[0].onmessage?.({
        data: { jobId: firstRequest.jobId, positions: [{ id: 'a', x: 0, y: 0 }] },
      } as MessageEvent)
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    rerender({ graph: graphB })
    // On this exact render -- before the job-posting effect has run and
    // before any worker response for graphB -- status must not read
    // 'ready' with graphA's stale nodes (the bug: deriving staleness from
    // a ref only mutated inside an effect, one render too late).
    expect(result.current.status).not.toBe('ready')
  })

  it('terminates and respawns the worker when a new job supersedes one still in flight', async () => {
    const graphA = { nodes: [node('a')], edges: [] }
    const graphB = { nodes: [node('b')], edges: [] }
    const { rerender } = renderHook(({ graph }) => useLayoutWorker(graph), {
      initialProps: { graph: graphA },
    })

    await waitFor(() => expect(spawnedWorkers.length).toBe(1))
    const firstWorker = spawnedWorkers[0]
    expect(firstWorker.terminated).toBe(false)

    // graphA's job is still in flight (no response yet) -- switching scope
    // now must cancel it via termination, not just queue a second job.
    rerender({ graph: graphB })

    await waitFor(() => expect(spawnedWorkers.length).toBe(2))
    expect(firstWorker.terminated).toBe(true)
  })

  it('ignores a response whose jobId does not match the in-flight job', async () => {
    const graphA = { nodes: [node('a')], edges: [] }
    const { result } = renderHook(({ graph }) => useLayoutWorker(graph), {
      initialProps: { graph: graphA },
    })

    await waitFor(() => expect(spawnedWorkers.length).toBe(1))
    const worker = spawnedWorkers[0]

    act(() => {
      worker.onmessage?.({ data: { jobId: 999999, positions: [] } } as MessageEvent)
    })

    expect(result.current.status).not.toBe('ready')
  })

  it('surfaces status "error" when the worker errors, and clears it once a new job is posted', async () => {
    const graphA = { nodes: [node('a')], edges: [] }
    const graphB = { nodes: [node('b')], edges: [] }
    const { result, rerender } = renderHook(({ graph }) => useLayoutWorker(graph), {
      initialProps: { graph: graphA },
    })

    await waitFor(() => expect(spawnedWorkers.length).toBe(1))
    const worker = spawnedWorkers[0]

    act(() => {
      worker.onerror?.({ message: 'boom' } as ErrorEvent)
    })

    await waitFor(() => expect(result.current.status).toBe('error'))

    rerender({ graph: graphB })
    await waitFor(() => expect(result.current.status).not.toBe('error'))
  })
})
