import type { GraphEdge, GraphNode } from '../api/types'

export interface TreeNode {
  node: GraphNode
  children: TreeNode[]
}

/**
 * Ids of every node with no incoming `defines` edge -- the same
 * root-detection rule `buildTree` uses internally, exposed standalone
 * for callers that only need the id set (e.g. deciding which top-level
 * items start selected/visible on the canvas) without building a full
 * tree. Historically this was equivalent to "kind is directory or
 * file", since every class/function always has a `defines` parent --
 * that stopped holding once `table`/`dbt_model` nodes (Milestone 17)
 * introduced a second kind of parentless node, so callers that still
 * filtered by kind silently dropped them from default selection.
 */
export function rootNodeIds(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const ids = new Set(nodes.map((node) => node.id))
  const hasParent = new Set<string>()
  for (const edge of edges) {
    if (edge.kind !== 'defines') continue
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    hasParent.add(edge.target)
  }
  return new Set(nodes.filter((node) => !hasParent.has(node.id)).map((node) => node.id))
}

/**
 * Builds a directory/file/class/function tree from the graph's `defines`
 * edges, which already encode exactly this hierarchy (dir -> subdir/file,
 * file -> class/function, class -> method). Root items are nodes with no
 * incoming `defines` edge (top-level directories and files).
 */
export function buildTree(nodes: GraphNode[], edges: GraphEdge[]): TreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childIdsByParent = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    if (edge.kind !== 'defines') continue
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue
    const siblings = childIdsByParent.get(edge.source) ?? []
    siblings.push(edge.target)
    childIdsByParent.set(edge.source, siblings)
    hasParent.add(edge.target)
  }

  function build(id: string): TreeNode {
    const node = byId.get(id)
    if (!node) {
      throw new Error(`buildTree: unknown node id "${id}"`)
    }
    const children = (childIdsByParent.get(id) ?? [])
      .map(build)
      .sort((a, b) => a.node.label.localeCompare(b.node.label))
    return { node, children }
  }

  return nodes
    .filter((node) => !hasParent.has(node.id))
    .map((node) => build(node.id))
    .sort((a, b) => a.node.label.localeCompare(b.node.label))
}

/** A directory with more than this many direct children starts collapsed. */
export const DEFAULT_COLLAPSE_CHILD_THRESHOLD = 5

export function isExpandedByDefault(item: TreeNode): boolean {
  return !(item.node.kind === 'directory' && item.children.length > DEFAULT_COLLAPSE_CHILD_THRESHOLD)
}

/** Ids of nodes whose label matches `query` (case-insensitive substring). */
export function collectMatchIds(roots: TreeNode[], query: string): Set<string> {
  const needle = query.trim().toLowerCase()
  const matches = new Set<string>()
  if (!needle) return matches

  function visit(item: TreeNode) {
    if (item.node.label.toLowerCase().includes(needle)) {
      matches.add(item.node.id)
    }
    for (const child of item.children) visit(child)
  }
  for (const root of roots) visit(root)
  return matches
}

/**
 * Ids of every node that must stay visible/expanded so each match in
 * `matchIds` is reachable: the match itself plus every ancestor on the
 * path down to it. Returns `null` when there are no matches, meaning
 * "no filter is narrowing the tree" (caller should fall back to normal
 * expand/collapse state).
 */
export function collectVisiblePath(roots: TreeNode[], matchIds: Set<string>): Set<string> | null {
  if (matchIds.size === 0) return null
  const visible = new Set<string>()

  function visit(item: TreeNode, ancestors: string[]): boolean {
    const childHasMatch = item.children.map((child) => visit(child, [...ancestors, item.node.id]))
    const isMatch = matchIds.has(item.node.id)
    const subtreeHasMatch = isMatch || childHasMatch.some(Boolean)
    if (subtreeHasMatch) {
      visible.add(item.node.id)
      for (const ancestor of ancestors) visible.add(ancestor)
    }
    return subtreeHasMatch
  }
  for (const root of roots) visit(root, [])
  return visible
}
