import type { GraphEdge, GraphNode } from '../api/types'

/** Kinds that get a canvas expand/collapse chevron -- a `directory` or
 * `file` not independently visible rolls up into whichever visible
 * ancestor contains it. `class` is deliberately not one: it has no
 * separate collapse toggle, so a class's methods fold up to whatever
 * `file`/`directory` ancestor is visible, same as if there were no class
 * in between. */
export const CONTAINER_KINDS = new Set<GraphNode['kind']>(['directory', 'file'])

export interface ContainerVisibility {
  /** True once this container has nothing left rolled up into it (every
   * `defines` child is itself independently visible, or rolled up further
   * into something else -- not this node). */
  expanded: boolean
  /** Descendants (at any depth) currently rolled up into this node. */
  hiddenDescendantCount: number
}

export interface CollapsedEdge extends GraphEdge {
  /** Present (>1) when more than one underlying edge collapsed into this
   * one after remapping both endpoints to their visible representative. */
  count?: number
}

export interface VisibleGraph {
  nodes: GraphNode[]
  edges: CollapsedEdge[]
  containerState: ReadonlyMap<string, ContainerVisibility>
}

/**
 * Single source of truth for the codebase canvas: a node id X renders as
 * its own box iff X itself is in `visibleIds`. Otherwise X rolls up into
 * whichever ancestor (walking up `defines` edges) is the *nearest* one
 * that's in `visibleIds`. A node with no ancestor in `visibleIds` at all,
 * and not itself in `visibleIds`, doesn't render -- this is what makes an
 * empty `visibleIds` the correct "nothing selected yet" starting state
 * for a large repo, with no separate inclusion gate needed.
 *
 * This replaces two previously-separate mechanisms -- a "selected roots"
 * subtree-inclusion gate (`subgraphForSelection`) and a per-container
 * "expanded" boolean (`collapseGraph`) -- that didn't compose: checking a
 * child in the sidebar while an ancestor directory was already selected
 * had no effect, since the old model only knew how to add a whole
 * subtree, never toggle one specific descendant regardless of its
 * ancestors' state. Here, checking or unchecking any id, at any depth,
 * always does exactly what it says: `visibleIds.has(id)` is checked
 * *first*, unconditionally, before ever consulting a parent.
 */
export function buildVisibleGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  visibleIds: ReadonlySet<string>,
): VisibleGraph {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const parentOf = new Map<string, string>()
  const childCountByParent = new Map<string, number>()
  for (const edge of edges) {
    if (edge.kind !== 'defines') continue
    parentOf.set(edge.target, edge.source)
    childCountByParent.set(edge.source, (childCountByParent.get(edge.source) ?? 0) + 1)
  }

  const representativeCache = new Map<string, string | undefined>()
  function representativeOf(id: string): string | undefined {
    const cached = representativeCache.get(id)
    if (cached !== undefined || representativeCache.has(id)) return cached
    let representative: string | undefined
    if (visibleIds.has(id)) {
      representative = id
    } else {
      const parent = parentOf.get(id)
      representative = parent === undefined ? undefined : representativeOf(parent)
    }
    representativeCache.set(id, representative)
    return representative
  }

  const hiddenDescendantCount = new Map<string, number>()
  const visibleNodes: GraphNode[] = []
  const seenRepresentatives = new Set<string>()
  for (const node of nodes) {
    const representative = representativeOf(node.id)
    if (representative === undefined) continue // no visible ancestor anywhere -- not rendered
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
    if ((childCountByParent.get(node.id) ?? 0) === 0) continue // nothing to expand/collapse
    const hidden = hiddenDescendantCount.get(node.id) ?? 0
    containerState.set(node.id, { expanded: hidden === 0, hiddenDescendantCount: hidden })
  }

  const edgeByKey = new Map<string, CollapsedEdge>()
  const collapsedEdges: CollapsedEdge[] = []
  for (const edge of edges) {
    const source = representativeOf(edge.source)
    const target = representativeOf(edge.target)
    if (source === undefined || target === undefined) continue
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

/** Every descendant of `id` (at any depth) via `defines` edges. Used by
 * the canvas chevron's collapse action to clear out however many levels
 * were drilled into under a container -- not just its immediate
 * children -- so re-collapsing it always folds everything back into one
 * box, regardless of how deep the user had gone. */
export function subtreeIds(id: string, edges: GraphEdge[]): Set<string> {
  const childIdsByParent = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== 'defines') continue
    const siblings = childIdsByParent.get(edge.source) ?? []
    siblings.push(edge.target)
    childIdsByParent.set(edge.source, siblings)
  }
  const result = new Set<string>()
  const stack = [...(childIdsByParent.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop() as string
    if (result.has(next)) continue
    result.add(next)
    for (const child of childIdsByParent.get(next) ?? []) stack.push(child)
  }
  return result
}

/** Immediate `defines` children of `id`. Used by the canvas expand action
 * to decide whether a container is small enough to expand directly, or
 * has too many children and should route the user to the sidebar
 * instead (see `EXPAND_CHILD_THRESHOLD` in `App.tsx`). */
export function directChildIds(id: string, edges: GraphEdge[]): string[] {
  const children: string[] = []
  for (const edge of edges) {
    if (edge.kind === 'defines' && edge.source === id) children.push(edge.target)
  }
  return children
}

/**
 * Every id in `visibleIds` whose entire chain of `defines` ancestors also
 * contains no other member of `visibleIds` -- i.e. folds every
 * drilled-into descendant back up into whichever ancestor made it
 * reachable, dropping the descendant's own explicit visibility. Used by
 * "Collapse All" to undo drill-down without discarding the user's
 * original top-level selections (each of which has no visible ancestor
 * of its own, so it's kept as-is).
 */
export function collapseToOutermost(visibleIds: ReadonlySet<string>, edges: GraphEdge[]): Set<string> {
  const parentOf = new Map<string, string>()
  for (const edge of edges) {
    if (edge.kind === 'defines') parentOf.set(edge.target, edge.source)
  }
  const result = new Set<string>()
  for (const id of visibleIds) {
    let hasVisibleAncestor = false
    for (let current = parentOf.get(id); current !== undefined; current = parentOf.get(current)) {
      if (visibleIds.has(current)) {
        hasVisibleAncestor = true
        break
      }
    }
    if (!hasVisibleAncestor) result.add(id)
  }
  return result
}
