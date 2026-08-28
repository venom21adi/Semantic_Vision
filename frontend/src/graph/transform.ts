import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { GraphEdge, GraphNode } from '../api/types'
import { layoutGraph } from './layout'
import type { GraphNodeData } from './nodeTypes'

/** Exported so `EdgeLegend.tsx` can render a swatch that's guaranteed to
 * match the actual line color -- one shared source, not a second copy
 * that could silently drift out of sync with this one. */
export const EDGE_COLORS: Record<GraphEdge['kind'], string> = {
  defines: '#94a3b8',
  imports: '#38bdf8',
  calls: '#fb923c',
  maps_to: '#22d3ee',
  foreign_key: '#0e7490',
  references: '#facc15',
  materializes: '#a16207',
  reads: '#4ade80',
  writes: '#f87171',
}

export function toFlowNodes(nodes: GraphNode[]): Node<GraphNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: 0, y: 0 },
    data: {
      label: node.label,
      kind: node.kind,
      file: node.file,
      lineStart: node.line_start,
      lineEnd: node.line_end,
      accessorKind: node.accessor_kind,
    },
  }))
}

/** Carried on every flow edge's `data` so a downstream consumer (the
 * edge-kind legend/filter) can tell kinds apart -- nothing else on a
 * React Flow `Edge` object survives `toFlowEdges` from the original
 * `GraphEdge.kind` (it's consumed here for label/color/dash but never
 * otherwise stored). */
export interface FlowEdgeData extends Record<string, unknown> {
  kind: GraphEdge['kind']
}

export function toFlowEdges(edges: (GraphEdge & { count?: number })[]): Edge<FlowEdgeData>[] {
  const occurrences = new Map<string, number>()

  return edges.map((edge) => {
    const base = `${edge.source}->${edge.target}:${edge.kind}`
    const index = occurrences.get(base) ?? 0
    occurrences.set(base, index + 1)
    const color = EDGE_COLORS[edge.kind]

    return {
      id: `${base}:${index}`,
      source: edge.source,
      target: edge.target,
      data: { kind: edge.kind },
      // `count` is set by `collapseGraph` when multiple underlying edges
      // rolled up into this one after remapping both endpoints to their
      // visible directory representative.
      //
      // `defines` gets no label at all -- it's the containment hierarchy
      // itself (already implied by the tree/nesting, and by the grey
      // color below), so a "defines" caption on every single one of them
      // is pure clutter once a container actually has several children on
      // screen at once -- confirmed as the exact complaint after the
      // collapse/expand redesign made that a common sight instead of a
      // rare one. Every other kind keeps its label -- "calls ×N" and
      // friends are real information a `defines` edge never carries.
      label:
        edge.kind === 'defines' ? undefined : edge.count && edge.count > 1 ? `${edge.kind} ×${edge.count}` : edge.kind,
      style: {
        stroke: color,
        strokeDasharray: edge.kind === 'imports' ? '4 3' : edge.ambiguous ? '2 2' : undefined,
        opacity: edge.external || edge.ambiguous ? 0.6 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    }
  })
}

export function buildFlowGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: Node<GraphNodeData>[]; edges: Edge<FlowEdgeData>[] } {
  const flowNodes = toFlowNodes(nodes)
  const flowEdges = toFlowEdges(edges)
  return { nodes: layoutGraph(flowNodes, flowEdges), edges: flowEdges }
}

/** Scopes a graph down to one file's own nodes (itself, its classes, and
 * its functions/methods) and the edges entirely contained within that
 * set -- used by the Codebase/File view toggle. */
export function scopeToFile(
  nodes: GraphNode[],
  edges: GraphEdge[],
  file: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const scopedIds = new Set(nodes.filter((node) => node.file === file).map((node) => node.id))
  return {
    nodes: nodes.filter((node) => scopedIds.has(node.id)),
    edges: edges.filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target)),
  }
}

export function neighborNodeIds(
  nodeId: string,
  edges: { source: string; target: string }[],
): string[] {
  const neighbors = new Set<string>([nodeId])
  for (const edge of edges) {
    if (edge.source === nodeId) neighbors.add(edge.target)
    if (edge.target === nodeId) neighbors.add(edge.source)
  }
  return Array.from(neighbors)
}
