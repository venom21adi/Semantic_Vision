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

/** Nudges every node *not* in `fixedIds` straight down until it clears
 * every already-placed node's bounding box, leaving `fixedIds` nodes
 * exactly where they are. Exists because dagre's own collision-free
 * layout only holds among the positions *it* computed -- once some of
 * those get overridden back to an arbitrary manually-dragged position
 * (`App.tsx`'s `flowGraph`, restoring a saved drag after a relayout),
 * whatever dagre had planned for the *other* nodes around that spot no
 * longer accounts for it, and a freshly-added node can land squarely on
 * top of one that just got dragged back into place -- confirmed live as
 * the cause of newly-selected sidebar items overlapping the existing
 * canvas. A straight-down nudge (not a general 2D bin-pack) is
 * deliberate: it's cheap, deterministic, and keeps a node close to
 * dagre's own horizontal placement (which still reflects real graph
 * structure) rather than scattering it somewhere unrelated. */
export function resolveNodeOverlaps<T extends { id: string; position: { x: number; y: number } }>(
  nodes: T[],
  fixedIds: ReadonlySet<string>,
): T[] {
  const GAP = 24

  function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return Math.abs(a.x - b.x) < NODE_WIDTH + GAP && Math.abs(a.y - b.y) < NODE_HEIGHT + GAP
  }

  // Fixed nodes seed the obstacle list first (in whatever order they
  // appear), so every movable node below is checked against the *entire*
  // fixed layout, not just whichever fixed nodes happen to precede it.
  const placed: { x: number; y: number }[] = []
  for (const node of nodes) {
    if (fixedIds.has(node.id)) placed.push(node.position)
  }

  const resolved = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    if (fixedIds.has(node.id)) continue
    let candidate = node.position
    // Bounded, not `while (true)`: a pathological input (hundreds of
    // fixed nodes stacked in this node's path) should give up and render
    // an imperfect-but-finite position rather than hang the render.
    for (let guard = 0; guard < 200 && placed.some((p) => overlaps(p, candidate)); guard++) {
      candidate = { x: candidate.x, y: candidate.y + NODE_HEIGHT + GAP }
    }
    placed.push(candidate)
    resolved.set(node.id, candidate)
  }

  if (resolved.size === 0) return nodes
  return nodes.map((node) => {
    const candidate = resolved.get(node.id)
    return candidate ? { ...node, position: candidate } : node
  })
}
