import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ComplexityScore, GraphNode } from '../api/types'
import { PackageImportersGraph } from './PackageImportersGraph'

function makeNode(id: string, label = id): GraphNode {
  return { id, kind: 'function', label, file: 'app.py', line_start: 1, line_end: 2 }
}

function makeScore(nodeId: string, cc = 1): ComplexityScore {
  return { node_id: nodeId, cyclomatic_complexity: cc, call_chain_depth: 0, has_nested_loops: false }
}

describe('PackageImportersGraph', () => {
  it('renders the package node and a node per resolved importer', () => {
    render(
      <PackageImportersGraph
        packageName="requests"
        hasVulnerabilities={false}
        importerNodeIds={['app.py::a', 'app.py::b']}
        graphNodes={[makeNode('app.py::a', 'a'), makeNode('app.py::b', 'b')]}
        scores={[makeScore('app.py::a'), makeScore('app.py::b')]}
      />,
    )

    expect(screen.getByText('requests')).toBeInTheDocument()
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('skips an importer id with no matching graph node instead of throwing', () => {
    expect(() =>
      render(
        <PackageImportersGraph
          packageName="requests"
          hasVulnerabilities={false}
          importerNodeIds={['app.py::missing']}
          graphNodes={[]}
          scores={[]}
        />,
      ),
    ).not.toThrow()

    expect(screen.getByText('requests')).toBeInTheDocument()
  })

  it('renders with no importer nodes when the list is empty', () => {
    render(
      <PackageImportersGraph
        packageName="requests"
        hasVulnerabilities
        importerNodeIds={[]}
        graphNodes={[]}
        scores={[]}
      />,
    )

    expect(screen.getByText('requests')).toBeInTheDocument()
  })
})
