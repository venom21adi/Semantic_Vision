import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../api/types'
import { buildFlowGraph, neighborNodeIds, scopeToFile, toFlowEdges, toFlowNodes } from './transform'

const nodes: GraphNode[] = [
  { id: 'app.py', kind: 'file', label: 'app.py', file: 'app.py', line_start: 1, line_end: 8 },
  {
    id: 'app.py::Greeter',
    kind: 'class',
    label: 'Greeter',
    file: 'app.py',
    line_start: 5,
    line_end: 8,
  },
  {
    id: 'app.py::Greeter.greet',
    kind: 'function',
    label: 'greet',
    file: 'app.py',
    line_start: 6,
    line_end: 8,
  },
]

const edges: GraphEdge[] = [
  { source: 'app.py', target: 'app.py::Greeter', kind: 'defines', external: false, ambiguous: false },
  {
    source: 'app.py::Greeter',
    target: 'app.py::Greeter.greet',
    kind: 'defines',
    external: false,
    ambiguous: false,
  },
  {
    source: 'app.py::Greeter.greet',
    target: 'external::os.path.join',
    kind: 'calls',
    external: true,
    ambiguous: false,
  },
]

describe('toFlowNodes', () => {
  it('maps kind to node type and carries label/file/line data', () => {
    const flowNodes = toFlowNodes(nodes)

    expect(flowNodes[0]).toMatchObject({
      id: 'app.py',
      type: 'file',
      data: { label: 'app.py', kind: 'file', file: 'app.py', lineStart: 1, lineEnd: 8 },
    })
  })
})

describe('toFlowEdges', () => {
  it('generates unique ids even for repeated source/target/kind pairs', () => {
    const duplicate: GraphEdge[] = [edges[2], edges[2]]

    const flowEdges = toFlowEdges(duplicate)

    expect(new Set(flowEdges.map((edge) => edge.id)).size).toBe(2)
  })

  it('always sets an arrowhead marker', () => {
    const flowEdges = toFlowEdges(edges)

    for (const edge of flowEdges) {
      expect(edge.markerEnd).toBeDefined()
    }
  })
})

describe('buildFlowGraph', () => {
  it('lays out nodes and returns edges with markers', () => {
    const graph = buildFlowGraph(nodes, edges)

    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(3)
    expect(graph.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true)
  })
})

describe('neighborNodeIds', () => {
  it('includes the node itself plus direct neighbors only', () => {
    const neighbors = neighborNodeIds('app.py::Greeter', edges)

    expect(new Set(neighbors)).toEqual(
      new Set(['app.py::Greeter', 'app.py', 'app.py::Greeter.greet']),
    )
  })

  it('does not include indirect (two-hop) neighbors', () => {
    const neighbors = neighborNodeIds('app.py', edges)

    expect(neighbors).not.toContain('app.py::Greeter.greet')
  })
})

describe('scopeToFile', () => {
  const helpersNode: GraphNode = {
    id: 'helpers.py::format_name',
    kind: 'function',
    label: 'format_name',
    file: 'helpers.py',
    line_start: 1,
    line_end: 2,
  }
  const helpersFileNode: GraphNode = {
    id: 'helpers.py',
    kind: 'file',
    label: 'helpers.py',
    file: 'helpers.py',
    line_start: 1,
    line_end: 2,
  }
  const crossFileCall: GraphEdge = {
    source: 'app.py::Greeter.greet',
    target: 'helpers.py::format_name',
    kind: 'calls',
    external: false,
    ambiguous: false,
  }
  const multiFileNodes = [...nodes, helpersFileNode, helpersNode]
  const multiFileEdges = [...edges, crossFileCall]

  it('keeps only nodes belonging to the target file', () => {
    const scoped = scopeToFile(multiFileNodes, multiFileEdges, 'app.py')

    expect(scoped.nodes.map((n) => n.id).sort()).toEqual(
      ['app.py', 'app.py::Greeter', 'app.py::Greeter.greet'].sort(),
    )
  })

  it('drops edges that cross into another file', () => {
    const scoped = scopeToFile(multiFileNodes, multiFileEdges, 'app.py')

    expect(scoped.edges.some((e) => e.target === 'helpers.py::format_name')).toBe(false)
  })

  it('keeps edges entirely within the target file', () => {
    const scoped = scopeToFile(multiFileNodes, multiFileEdges, 'app.py')

    expect(scoped.edges).toContainEqual(
      expect.objectContaining({ source: 'app.py', target: 'app.py::Greeter' }),
    )
  })
})
