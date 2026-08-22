import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { GraphEdge, GraphNode } from '../api/types'
import { layoutGraph } from './layout'
import type { GraphNodeData } from './nodeTypes'

const EDGE_COLORS: Record<GraphEdge['kind'], string> = {
  defines: '#94a3b8',
  imports: '#38bdf8',
  calls: '#fb923c',
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
    },
  }))
}

export function toFlowEdges(edges: GraphEdge[]): Edge[] {
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
      label: edge.kind,
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
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
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
