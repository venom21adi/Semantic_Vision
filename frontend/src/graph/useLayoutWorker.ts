import { useEffect, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { GraphEdge, GraphNode } from '../api/types'
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout'
import type { GraphNodeData } from './nodeTypes'
import { toFlowEdges, toFlowNodes } from './transform'
import type { LayoutRequest, LayoutResponse } from './layoutProtocol'
import LayoutWorkerCtor from './layout.worker?worker'

export type LayoutStatus = 'idle' | 'laying-out' | 'ready' | 'error'

export interface ScopedGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface LayoutResult {
  status: LayoutStatus
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
}

interface InFlightJob {
  jobId: number
  flowNodes: Node<GraphNodeData>[]
  flowEdges: Edge[]
}

interface ReadyResult {
  // The exact `scopedGraph`/`direction` this result was computed for --
  // compared by identity against the hook's current arguments, synchronously
  // during render, to decide `status`. Deliberately *not* derived from
  // `jobId`: `jobId` is only bumped inside the job-posting effect below,
  // which runs after the render/commit for a new `scopedGraph` -- so on
  // that render, a jobId-based check would still see the *old* job as
  // current and report `'ready'` with the *old* (wrong-scope) nodes/edges,
  // which React would then actually paint for one frame before the effect
  // ran and corrected it.
  forScopedGraph: ScopedGraph
  forDirection: 'TB' | 'LR'
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
}

interface ErroredResult {
  // Same reasoning as `ReadyResult.forScopedGraph` above -- compared by
  // identity during render, not via `jobIdRef` (which is only bumped
  // inside the job-posting effect, one render too late to clear a stale
  // 'error' status on the very render where `scopedGraph` changes).
  forScopedGraph: ScopedGraph
  forDirection: 'TB' | 'LR'
}

/** No `Worker` global (any environment without Worker support, or jsdom
 * under vitest, which never implements it) -- run layout synchronously on
 * the main thread instead, identical to this app's pre-worker behavior.
 * This is also this file's entire test seam: it needs no mocks, since
 * `vitest run` always takes this branch. */
const hasWorker = typeof Worker !== 'undefined'

function spawnWorker(
  onMessage: (event: MessageEvent<LayoutResponse>) => void,
  onError: (event: ErrorEvent) => void,
): Worker {
  const worker = new LayoutWorkerCtor()
  worker.onmessage = onMessage
  worker.onerror = onError
  return worker
}

/** Runs `dagre.layout()` (via `layoutGraph`) off the main thread, so a
 * large repo's layout no longer blocks React's render -- the literal cause
 * of this app freezing/being killed by Chrome on large repos (see
 * docs/PERFORMANCE-REPORT.md, Iteration 0). Keyed only on `scopedGraph`
 * and `direction`, deliberately not on the whole `repo` object -- callers
 * must pass a `scopedGraph` whose `nodes`/`edges` identity is itself stable
 * across unrelated `repo` changes (e.g. the 60s position autosave), or this
 * still re-runs a full relayout for no reason. */
export function useLayoutWorker(
  scopedGraph: ScopedGraph,
  direction: 'TB' | 'LR' = 'TB',
): LayoutResult {
  const workerRef = useRef<Worker | null>(null)
  const jobIdRef = useRef(0)
  const inFlightRef = useRef<InFlightJob | null>(null)
  const onMessageRef = useRef<(event: MessageEvent<LayoutResponse>) => void>(() => {})
  const onErrorRef = useRef<(event: ErrorEvent) => void>(() => {})
  const [ready, setReady] = useState<ReadyResult | null>(null)
  const [errored, setErrored] = useState<ErroredResult | null>(null)

  onMessageRef.current = (event) => {
    const job = inFlightRef.current
    if (!job || job.jobId !== event.data.jobId) return // superseded -- discard
    const posById = new Map(event.data.positions.map((position) => [position.id, position]))
    const positioned = job.flowNodes.map((node) => {
      const pos = posById.get(node.id)
      if (!pos) return node
      // `layoutGraph` (run inside the worker) already returns final,
      // node-size-adjusted positions -- no further offset here. The
      // worker's own `LayoutResponse` only carries `{id, x, y}`, not full
      // nodes, so `measured` has to be set again here -- otherwise this
      // reassembly step (using `job.flowNodes`, the *pre*-layout nodes)
      // silently drops it, and `fitView()` -- which strictly requires
      // `measured.width`/`measured.height` on a node before including it
      // in its bounds -- computes an empty bounding box and does nothing,
      // for every node, every time (the actual cause of the "Fit view"
      // control button never doing anything, confirmed live: only the
      // no-`Worker` test/fallback path below ever went through
      // `layoutGraph`'s own `measured` directly).
      return { ...node, position: { x: pos.x, y: pos.y }, measured: { width: NODE_WIDTH, height: NODE_HEIGHT } }
    })
    setReady({
      forScopedGraph: scopedGraph,
      forDirection: direction,
      nodes: positioned,
      edges: job.flowEdges,
    })
    inFlightRef.current = null
  }

  onErrorRef.current = (event) => {
    const job = inFlightRef.current
    if (!job) return // superseded -- a newer job already cleared it
    // Surface the failure instead of leaving `status` stuck at
    // 'laying-out' forever with nothing to show and nothing logged --
    // strictly worse than this app's pre-worker behavior, where a failure
    // at least eventually surfaced as Chrome's own unresponsive-tab dialog.
    console.error('Graph layout worker failed:', event.message)
    inFlightRef.current = null
    setErrored({ forScopedGraph: scopedGraph, forDirection: direction })
  }

  useEffect(() => {
    if (!hasWorker) return
    workerRef.current = spawnWorker(
      (event) => onMessageRef.current(event),
      (event) => onErrorRef.current(event),
    )
    return () => {
      // Terminate whatever worker is current at unmount -- the job-posting
      // effect below may have already respawned it since this effect's own
      // `worker` local ran, so closing over that local instead would leak
      // the respawned one.
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const flowNodes = toFlowNodes(scopedGraph.nodes)
    const flowEdges = toFlowEdges(scopedGraph.edges)
    const jobId = ++jobIdRef.current

    if (!hasWorker) {
      setReady({
        forScopedGraph: scopedGraph,
        forDirection: direction,
        nodes: layoutGraph(flowNodes, flowEdges, direction),
        edges: flowEdges,
      })
      return
    }

    // `dagre.layout()` isn't interruptible, so a job already running in the
    // worker for a now-superseded request can't be cancelled in place --
    // discarding its eventual answer isn't enough on its own, since
    // repeated view/repo switches during a multi-minute layout could queue
    // jobs that each still run to completion. Terminating and respawning
    // the worker is the actual cancel; the respawn itself costs sub-ms next
    // to what it's cutting off.
    if (inFlightRef.current) {
      workerRef.current?.terminate()
      workerRef.current = spawnWorker(
        (event) => onMessageRef.current(event),
        (event) => onErrorRef.current(event),
      )
    }

    inFlightRef.current = { jobId, flowNodes, flowEdges }
    const request: LayoutRequest = {
      jobId,
      direction,
      nodeIds: scopedGraph.nodes.map((node) => node.id),
      edges: scopedGraph.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    }
    workerRef.current?.postMessage(request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedGraph, direction])

  const isReadyForCurrent =
    ready && ready.forScopedGraph === scopedGraph && ready.forDirection === direction
  if (isReadyForCurrent) {
    return { status: 'ready', nodes: ready.nodes, edges: ready.edges }
  }
  const isErroredForCurrent =
    errored && errored.forScopedGraph === scopedGraph && errored.forDirection === direction
  if (isErroredForCurrent) {
    return { status: 'error', nodes: [], edges: [] }
  }
  // Neither ready nor errored for the current scope/direction -- either
  // still laying it out, or (if `ready` has never been set at all) the
  // very first render before any effect has run yet. Once `scopedGraph`
  // changes again, `errored` (if set) stops matching immediately (this is
  // this hook's retry path -- no separate "retry" action needed).
  return { status: ready ? 'laying-out' : 'idle', nodes: [], edges: [] }
}
