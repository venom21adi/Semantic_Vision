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

/**
 * Merges edges sharing the same (source, target, kind) into one, joining
 * their labels with a comma -- `switch` fallthrough (Milestone
 * JS-TS-FLOWCHART-PLAN) is the first real producer of this shape: two
 * different `case` values landing on the identical next node get two
 * distinct `FlowEdge`s with different labels ("2", "3") but the same
 * source/target/kind. Rendered as genuinely separate React Flow edges
 * (each with its own id, the previous behavior here), they lay out on
 * top of each other -- dagre has no reason to separate two edges
 * between the same pair of nodes -- so only one label ever ends up
 * visible, silently hiding that two cases fall through to the same
 * place. One combined edge labeled "2, 3" is both accurate and
 * actually legible. Verified live in a real browser against the
 * `switchWithFallthrough` fixture, not assumed.
 */
export function toFlowchartEdges(edges: FlowEdge[]): Edge[] {
  const groups = new Map<
    string,
    { source: string; target: string; kind: FlowEdge['kind']; labels: string[] }
  >()

  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}:${edge.kind}`
    const existing = groups.get(key)
    if (existing) {
      if (edge.label) existing.labels.push(edge.label)
    } else {
      groups.set(key, {
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        labels: edge.label ? [edge.label] : [],
      })
    }
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    const color = FLOW_EDGE_COLORS[group.kind]
    return {
      id: key,
      source: group.source,
      target: group.target,
      label: group.labels.length > 0 ? group.labels.join(', ') : undefined,
      style: {
        stroke: color,
        strokeDasharray: group.kind === 'loop_back' ? '4 3' : undefined,
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
