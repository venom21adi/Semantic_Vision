import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

export const NODE_WIDTH = 172
export const NODE_HEIGHT = 40

export function layoutGraph<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): Node<T>[] {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: direction })

  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const node of nodes) {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    // graphlib's `setEdge` silently auto-creates any endpoint it hasn't
    // seen via `setNode` yet -- an edge to a call/import target with no
    // corresponding node (e.g. a stdlib/third-party symbol like
    // `external::numpy`, never rendered as an actual graph node) would
    // otherwise implicitly hand dagre an extra node to lay out per
    // distinct external symbol, unbounded by the graph's real node count
    // and invisible to any node-count-based sizing. Confirmed as a real,
    // large cost on a large repo: thousands of distinct external targets
    // turned a nominally ~12-node collapsed graph into one dagre actually
    // laid out as if it had thousands.
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    dagreGraph.setEdge(edge.source, edge.target)
  }

  dagre.layout(dagreGraph)

  return nodes.map((node) => {
    const position = dagreGraph.node(node.id)
    return {
      ...node,
      position: { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 },
      // React Flow's `fitView()` only includes a node in its bounds
      // calculation once `measured.width`/`measured.height` are set --
      // normally populated asynchronously via ResizeObserver after the
      // node paints. Since dagre already laid out every node assuming
      // this exact fixed size (`dagreGraph.setNode` above), setting it
      // here too means `fitView` (the Controls button, and the
      // double-click-to-neighbors handler) works immediately, instead of
      // silently computing an empty bounding box -- and therefore doing
      // nothing at all -- whenever it runs before measurement catches up
      // (which was happening on every call, since `initialNodes` gets a
      // fresh object identity, and so a fresh unmeasured state, on every
      // relayout).
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
    }
  })
}
