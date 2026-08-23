import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { FlowEdge, FlowNode } from '../api/types'
import { layoutGraph } from '../graph/layout'
import type { FlowNodeData } from './nodeTypes'

const FLOW_EDGE_COLORS: Record<FlowEdge['kind'], string> = {
  flow: '#94a3b8',
  true: '#4ade80',
  false: '#f87171',
  loop_back: '#c084fc',
}

export function toFlowchartNodes(nodes: FlowNode[]): Node<FlowNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: 0, y: 0 },
    data: {
      label: node.label,
      kind: node.kind,
      line: node.line,
      endLine: node.end_line,
    },
  }))
}

export function toFlowchartEdges(edges: FlowEdge[]): Edge[] {
  const occurrences = new Map<string, number>()

  return edges.map((edge) => {
    const base = `${edge.source}->${edge.target}:${edge.kind}`
    const index = occurrences.get(base) ?? 0
    occurrences.set(base, index + 1)
    const color = FLOW_EDGE_COLORS[edge.kind]

    return {
      id: `${base}:${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.label ?? undefined,
      style: {
        stroke: color,
        strokeDasharray: edge.kind === 'loop_back' ? '4 3' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    }
  })
}

export function buildFlowchartGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const flowNodes = toFlowchartNodes(nodes)
  const flowEdges = toFlowchartEdges(edges)
  return { nodes: layoutGraph(flowNodes, flowEdges), edges: flowEdges }
}
