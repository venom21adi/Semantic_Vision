import type { Edge, Node } from '@xyflow/react'
import { layoutGraph } from './layout'
import type { LayoutRequest, LayoutResponse } from './layoutProtocol'

/** Reuses `layoutGraph` unchanged, fed minimal stub nodes/edges built from
 * the request's ids/pairs -- layout only ever reads a node's `id` and an
 * edge's `source`/`target`, never the label/kind/file/style/marker data a
 * full flow node/edge carries, so that data never has to cross the
 * postMessage boundary. */
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { jobId, direction, nodeIds, edges } = event.data
  const stubNodes: Node[] = nodeIds.map((id) => ({ id, position: { x: 0, y: 0 }, data: {} }))
  const stubEdges: Edge[] = edges.map((edge, index) => ({
    id: String(index),
    source: edge.source,
    target: edge.target,
  }))
  const positioned = layoutGraph(stubNodes, stubEdges, direction)
  const response: LayoutResponse = {
    jobId,
    positions: positioned.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
    })),
  }
  self.postMessage(response)
}
