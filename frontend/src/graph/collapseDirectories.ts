import type { GraphEdge, GraphNode } from '../api/types'

/** Kinds that act as a collapse boundary -- a `directory` or `file` not in
 * `expandedContainerIds` rolls up everything it (transitively) contains.
 * `class` is deliberately not one: it has no separate collapse toggle, so
 * a class's methods fold up to whatever `file`/`directory` ancestor is
 * collapsed, same as if there were no class in between. Splitting this out
 * once, here, rather than inlining it, is what keeps that decision a
 * single source of truth. */
const CONTAINER_KINDS = new Set<GraphNode['kind']>(['directory', 'file'])

export interface ContainerVisibility {
  expanded: boolean
  /** Descendants (at any depth) rolled up into this node -- 0 when
   * expanded or when this isn't a directory/file. */
  hiddenDescendantCount: number
}

export interface CollapsedEdge extends GraphEdge {
  /** Present (>1) when more than one underlying edge collapsed into this
   * one after remapping both endpoints to their visible representative. */
  count?: number
}

export interface CollapsedGraph {
  nodes: GraphNode[]
  edges: CollapsedEdge[]
  containerState: ReadonlyMap<string, ContainerVisibility>
}

/** Collapses every directory or file not in `expandedContainerIds` down to
 * its own node, rolling up everything inside it (subdirectories, files,
 * classes, functions, at any depth) into that one node -- so a large
 * repo's graph only has to lay out as many nodes as are actually visible,
 * not the whole repo.
 *
 * Both `directory` and `file` are collapse boundaries, not just
 * `directory`: a single root-level file can define far more nodes (and,
 * critically, far more edges once they all fan out to the same handful of
 * collapsed directories) than an entire small subdirectory -- confirmed on
 * a real large repo, where directory-only collapse left two root-level
 * files' ~25 methods fully expanded, producing a 37-node graph with 6,958
 * edges among them and a ~56s layout, because `dagre`'s cost tracks edge
 * density, not node count. Collapsing files too cuts that at the source.
 *
 * `defines` edges are kept (remapped/aggregated like any other kind):
 * they're the only visual cue tying a freshly-expanded child back to the
 * container that revealed it, since no node-kind here renders with any
 * other containment cue. A fully-expanded `expandedContainerIds` (every
 * directory and file id) reproduces the input node/edge set unchanged. */
export function collapseGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedContainerIds: ReadonlySet<string>,
): CollapsedGraph {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const parentOf = new Map<string, string>()
  for (const edge of edges) {
    if (edge.kind === 'defines') parentOf.set(edge.target, edge.source)
  }

  const representativeCache = new Map<string, string>()
  function representativeOf(id: string): string {
    const cached = representativeCache.get(id)
    if (cached !== undefined) return cached
    const parent = parentOf.get(id)
    let representative: string
    if (parent === undefined) {
      // No parent -- always visible as itself, regardless of
      // `expandedContainerIds`. This is what makes an empty
      // `expandedContainerIds` already correct for "show top-level
      // structure only": every top-level node has no parent, so it's
      // always its own representative here.
      representative = id
    } else {
      const parentRepresentative = representativeOf(parent)
      if (parentRepresentative !== parent) {
        // The parent itself already rolled up into some ancestor -- fold
        // into that same outermost collapsed ancestor, not the immediate
        // parent, so nested collapse doesn't produce a chain of bubbles.
        representative = parentRepresentative
      } else if (
        CONTAINER_KINDS.has(nodeById.get(parent)?.kind as GraphNode['kind']) &&
        !expandedContainerIds.has(parent)
      ) {
        representative = parent
      } else {
        representative = id
      }
    }
    representativeCache.set(id, representative)
    return representative
  }

  const hiddenDescendantCount = new Map<string, number>()
  const visibleNodes: GraphNode[] = []
  const seenRepresentatives = new Set<string>()
  for (const node of nodes) {
    const representative = representativeOf(node.id)
    if (representative !== node.id) {
      hiddenDescendantCount.set(representative, (hiddenDescendantCount.get(representative) ?? 0) + 1)
    }
    if (!seenRepresentatives.has(representative)) {
      seenRepresentatives.add(representative)
      const representativeNode = nodeById.get(representative)
      if (representativeNode) visibleNodes.push(representativeNode)
    }
  }

  const containerState = new Map<string, ContainerVisibility>()
  for (const node of visibleNodes) {
    if (!CONTAINER_KINDS.has(node.kind)) continue
    containerState.set(node.id, {
      expanded: expandedContainerIds.has(node.id),
      hiddenDescendantCount: hiddenDescendantCount.get(node.id) ?? 0,
    })
  }

  const edgeByKey = new Map<string, CollapsedEdge>()
  const collapsedEdges: CollapsedEdge[] = []
  for (const edge of edges) {
    const source = representativeOf(edge.source)
    const target = representativeOf(edge.target)
    if (source === target) continue // self-loop from full collapse -- drop
    const key = `${source}->${target}:${edge.kind}`
    const existing = edgeByKey.get(key)
    if (existing) {
      existing.count = (existing.count ?? 1) + 1
      existing.external = existing.external || edge.external
      existing.ambiguous = existing.ambiguous || edge.ambiguous
    } else {
      const merged: CollapsedEdge = {
        source,
        target,
        kind: edge.kind,
        external: edge.external,
        ambiguous: edge.ambiguous,
      }
      edgeByKey.set(key, merged)
      collapsedEdges.push(merged)
    }
  }

  return { nodes: visibleNodes, edges: collapsedEdges, containerState }
}

/** The chain of container (directory/file) ids strictly above `nodeId` in
 * the containment tree, nearest first. Used to force-expand whatever's
 * currently collapsing a node that got selected some other way than
 * clicking through the graph itself -- the sidebar's file/symbol tree
 * (`tree/buildTree.ts`) isn't collapse-aware, so without this, selecting
 * a node buried inside a collapsed container would set `selectedNodeId`
 * to something `collapseGraph` never renders: no highlight, no pan/zoom,
 * a details panel open for a node invisible on the canvas. */
export function ancestorContainerIds(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const parentOf = new Map<string, string>()
  for (const edge of edges) {
    if (edge.kind === 'defines') parentOf.set(edge.target, edge.source)
  }
  const ancestors: string[] = []
  let current = parentOf.get(nodeId)
  while (current !== undefined) {
    if (CONTAINER_KINDS.has(nodeById.get(current)?.kind as GraphNode['kind'])) {
      ancestors.push(current)
    }
    current = parentOf.get(current)
  }
  return ancestors
}
