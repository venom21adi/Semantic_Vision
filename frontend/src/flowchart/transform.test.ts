import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNode } from '../api/types'
import { buildFlowchartGraph, toFlowchartEdges, toFlowchartNodes } from './transform'

const nodes: FlowNode[] = [
  { id: 'app.py::greet::n0', kind: 'entry', label: 'def greet(x):', line: 1, end_line: 1 },
  { id: 'app.py::greet::n1', kind: 'decision', label: 'if x > 0', line: 2, end_line: 2 },
  { id: 'app.py::greet::n2', kind: 'return', label: 'return x', line: 3, end_line: 3 },
]

const edges: FlowEdge[] = [
  { source: 'app.py::greet::n0', target: 'app.py::greet::n1', kind: 'flow', label: null },
  { source: 'app.py::greet::n1', target: 'app.py::greet::n2', kind: 'true', label: 'Yes' },
  { source: 'app.py::greet::n1', target: 'app.py::greet::n2', kind: 'false', label: 'No' },
]

describe('toFlowchartNodes', () => {
  it('maps kind to node type and carries label/line data', () => {
    const flowNodes = toFlowchartNodes(nodes)

    expect(flowNodes[0]).toMatchObject({
      id: 'app.py::greet::n0',
      type: 'entry',
      data: { label: 'def greet(x):', kind: 'entry', line: 1, endLine: 1 },
    })
  })
})

describe('toFlowchartEdges', () => {
  it('merges edges sharing the same source/target/kind into one, joining their labels', () => {
    // Two `switch` cases (labels "2" and "3") falling through to the
    // same next node -- the first real producer of this shape.
    const fallthrough: FlowEdge[] = [
      { source: 'app.ts::f::n1', target: 'app.ts::f::n2', kind: 'flow', label: '2' },
      { source: 'app.ts::f::n1', target: 'app.ts::f::n2', kind: 'flow', label: '3' },
    ]

    const flowEdges = toFlowchartEdges(fallthrough)

    expect(flowEdges).toHaveLength(1)
    expect(flowEdges[0].label).toBe('2, 3')
  })

  it('keeps edges with different kinds between the same nodes separate', () => {
    const flowEdges = toFlowchartEdges([edges[1], edges[2]])

    expect(new Set(flowEdges.map((edge) => edge.id)).size).toBe(2)
  })

  it('carries the Yes/No label through, not the edge kind string', () => {
    const flowEdges = toFlowchartEdges(edges)

    expect(flowEdges[1].label).toBe('Yes')
    expect(flowEdges[2].label).toBe('No')
  })

  it('always sets an arrowhead marker', () => {
    const flowEdges = toFlowchartEdges(edges)

    for (const edge of flowEdges) {
      expect(edge.markerEnd).toBeDefined()
    }
  })

  it('dashes loop_back edges distinctly from a plain flow edge', () => {
    const loopBack: FlowEdge = { source: 'a', target: 'b', kind: 'loop_back', label: null }
    const flow: FlowEdge = { source: 'a', target: 'c', kind: 'flow', label: null }

    const [loopBackEdge, flowEdge] = toFlowchartEdges([loopBack, flow])

    expect(loopBackEdge.style?.strokeDasharray).toBeDefined()
    expect(flowEdge.style?.strokeDasharray).toBeUndefined()
  })
})

describe('buildFlowchartGraph', () => {
  it('lays out nodes and returns edges with markers', () => {
    const graph = buildFlowchartGraph(nodes, edges)

    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(3)
    expect(graph.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true)
  })
})
