import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComplexityScore, GraphEdge, GraphNode } from '../api/types'
import { MiniCallGraph } from './MiniCallGraph'

function makeNode(id: string, label = id): GraphNode {
  return { id, kind: 'function', label, file: 'app.py', line_start: 1, line_end: 2 }
}

function makeScore(nodeId: string, cc = 1, depth = 0): ComplexityScore {
  return { node_id: nodeId, cyclomatic_complexity: cc, call_chain_depth: depth, has_nested_loops: false }
}

function makeEdge(source: string, target: string): GraphEdge {
  return { source, target, kind: 'calls', external: false, ambiguous: false }
}

describe('MiniCallGraph', () => {
  it('renders a node per score', () => {
    render(
      <MiniCallGraph
        nodes={[makeNode('app.py::a', 'a'), makeNode('app.py::b', 'b')]}
        edges={[]}
        scores={[makeScore('app.py::a'), makeScore('app.py::b')]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('calls onSelectNode with the node id when a node is clicked', async () => {
    const onSelectNode = vi.fn()
    const user = userEvent.setup()
    render(
      <MiniCallGraph
        nodes={[makeNode('app.py::a', 'a')]}
        edges={[]}
        scores={[makeScore('app.py::a')]}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />,
    )

    await user.click(screen.getByText('a'))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::a')
  })

  it('only renders call edges between nodes that are actually present', () => {
    // No assertion on the rendered edge SVG itself (React Flow renders
    // edges as generated path elements, not text) -- this test exists to
    // confirm rendering with a dangling edge (target not in `nodes`)
    // doesn't throw, which it would if dagre's layout choked on an
    // unknown node id.
    expect(() =>
      render(
        <MiniCallGraph
          nodes={[makeNode('app.py::a')]}
          edges={[makeEdge('app.py::a', 'app.py::missing')]}
          scores={[makeScore('app.py::a')]}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
        />,
      ),
    ).not.toThrow()
  })

  it('marks the selected node visually distinct', () => {
    render(
      <MiniCallGraph
        nodes={[makeNode('app.py::a', 'a'), makeNode('app.py::b', 'b')]}
        edges={[]}
        scores={[makeScore('app.py::a'), makeScore('app.py::b')]}
        selectedNodeId="app.py::a"
        onSelectNode={vi.fn()}
      />,
    )

    const selectedNode = screen.getByTestId('rf__node-app.py::a')
    expect(selectedNode).toHaveClass('selected')
  })
})
