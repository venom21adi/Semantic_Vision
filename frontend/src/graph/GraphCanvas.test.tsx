import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComplexityScore, GraphEdge } from '../api/types'
import { AUTO_SAVE_POSITIONS_INTERVAL_MS, GraphCanvas, LARGE_GRAPH_NODE_THRESHOLD } from './GraphCanvas'
import { COMPLEX_COLOR } from './heatmap'
import { KIND_COLORS, type GraphNodeData } from './nodeTypes'
import type { FlowEdgeData } from './transform'

function makeNode(id: string, kind: GraphNodeData['kind'] = 'function'): Node<GraphNodeData> {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { label: id, kind, file: 'app.py', lineStart: 1, lineEnd: 2 },
  }
}

function makeEdge(source: string, target: string, kind: GraphEdge['kind']): Edge<FlowEdgeData> {
  return { id: `${source}->${target}:${kind}`, source, target, data: { kind, laneOffset: 0 } }
}

const noop = {
  onSelectNode: vi.fn(),
  onDocument: vi.fn(),
  onImpactAnalysis: vi.fn(),
  onViewSource: vi.fn(),
  onExecutionFlowchart: vi.fn(),
  onToggleContainer: vi.fn(),
}

describe('GraphCanvas', () => {
  it('renders node labels', () => {
    render(<GraphCanvas nodes={[makeNode('a'), makeNode('b')]} edges={[]} selectedNodeId={null} {...noop} />)

    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('calls onSelectNode when a node is clicked', async () => {
    const onSelectNode = vi.fn()
    const user = userEvent.setup()
    render(
      <GraphCanvas nodes={[makeNode('a')]} edges={[]} selectedNodeId={null} {...noop} onSelectNode={onSelectNode} />,
    )

    await user.click(screen.getByText('a'))

    expect(onSelectNode).toHaveBeenCalledWith('a')
  })

  it('shows a getter and setter with distinct "get "/"set " prefixes, not two identical boxes', () => {
    const getterNode: Node<GraphNodeData> = {
      id: 'app.ts::Box.value#get',
      type: 'function',
      position: { x: 0, y: 0 },
      data: { label: 'value', kind: 'function', file: 'app.ts', lineStart: 2, lineEnd: 4, accessorKind: 'get' },
    }
    const setterNode: Node<GraphNodeData> = {
      id: 'app.ts::Box.value#set',
      type: 'function',
      position: { x: 0, y: 0 },
      data: { label: 'value', kind: 'function', file: 'app.ts', lineStart: 6, lineEnd: 8, accessorKind: 'set' },
    }
    render(<GraphCanvas nodes={[getterNode, setterNode]} edges={[]} selectedNodeId={null} {...noop} />)

    expect(screen.getByText('get value')).toBeInTheDocument()
    expect(screen.getByText('set value')).toBeInTheDocument()
    expect(screen.queryByText('value')).not.toBeInTheDocument()
  })

  it('calls onToggleContainer, not onSelectNode, when the chevron on a collapse-managed node is clicked', async () => {
    const onSelectNode = vi.fn()
    const onToggleContainer = vi.fn()
    const user = userEvent.setup()
    render(
      <GraphCanvas
        nodes={[makeNode('pkg', 'directory')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        onSelectNode={onSelectNode}
        onToggleContainer={onToggleContainer}
        containerState={new Map([['pkg', { expanded: false, hiddenDescendantCount: 3 }]])}
      />,
    )

    const chevron = screen.getByTitle('pkg').querySelector('[data-node-toggle]')
    expect(chevron).not.toBeNull()
    await user.click(chevron as Element)

    expect(onToggleContainer).toHaveBeenCalledWith('pkg')
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it('still calls onSelectNode when clicking a collapse-managed node anywhere other than its chevron', async () => {
    // Regression check: a directory/file node has a real click behavior
    // worth keeping (selecting it -- e.g. to View Source/Document a
    // whole file via the context menu), so only the chevron itself should
    // toggle, not the entire node body.
    const onSelectNode = vi.fn()
    const onToggleContainer = vi.fn()
    const user = userEvent.setup()
    render(
      <GraphCanvas
        nodes={[makeNode('app.py', 'file')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        onSelectNode={onSelectNode}
        onToggleContainer={onToggleContainer}
        containerState={new Map([['app.py', { expanded: false, hiddenDescendantCount: 2 }]])}
      />,
    )

    await user.click(screen.getByTitle('app.py'))

    expect(onSelectNode).toHaveBeenCalledWith('app.py')
    expect(onToggleContainer).not.toHaveBeenCalled()
  })

  it('falls back to onSelectNode for a directory/file node with no containerState entry (e.g. file view)', async () => {
    const onSelectNode = vi.fn()
    const onToggleContainer = vi.fn()
    const user = userEvent.setup()
    render(
      <GraphCanvas
        nodes={[makeNode('app.py', 'file')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        onSelectNode={onSelectNode}
        onToggleContainer={onToggleContainer}
      />,
    )

    await user.click(screen.getByTitle('app.py'))

    expect(onSelectNode).toHaveBeenCalledWith('app.py')
    expect(onToggleContainer).not.toHaveBeenCalled()
  })

  it('renders a chevron and hidden-descendant count for a collapsed container node', () => {
    render(
      <GraphCanvas
        nodes={[makeNode('pkg', 'directory')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        containerState={new Map([['pkg', { expanded: false, hiddenDescendantCount: 3 }]])}
      />,
    )

    expect(screen.getByTitle('pkg').textContent).toBe('▸ pkg (3)')
  })

  it('renders an expanded chevron with no count for an expanded container node', () => {
    render(
      <GraphCanvas
        nodes={[makeNode('pkg', 'directory')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        containerState={new Map([['pkg', { expanded: true, hiddenDescendantCount: 0 }]])}
      />,
    )

    expect(screen.getByTitle('pkg').textContent).toBe('▾ pkg')
  })

  it('calls onSelectNode(null) when clicking empty canvas space', () => {
    const onSelectNode = vi.fn()
    const { container } = render(
      <GraphCanvas
        nodes={[makeNode('a')]}
        edges={[]}
        selectedNodeId="a"
        {...noop}
        onSelectNode={onSelectNode}
      />,
    )

    const pane = container.querySelector('.react-flow__pane')
    expect(pane).not.toBeNull()
    fireEvent.click(pane as Element)

    expect(onSelectNode).toHaveBeenCalledWith(null)
  })

  it('shows a warning banner above the node-count threshold', () => {
    const nodes = Array.from({ length: LARGE_GRAPH_NODE_THRESHOLD + 1 }, (_, i) => makeNode(`n${i}`))
    render(<GraphCanvas nodes={nodes} edges={[]} selectedNodeId={null} {...noop} />)

    expect(screen.getByRole('alert')).toHaveTextContent(`${LARGE_GRAPH_NODE_THRESHOLD + 1} nodes`)
  })

  it('does not show a warning banner at or below the threshold', () => {
    const nodes = Array.from({ length: LARGE_GRAPH_NODE_THRESHOLD }, (_, i) => makeNode(`n${i}`))
    render(<GraphCanvas nodes={nodes} edges={[]} selectedNodeId={null} {...noop} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('tints a node by its complexity score when complexityByNodeId is set', () => {
    const complexityByNodeId = new Map<string, ComplexityScore>([
      ['a', { node_id: 'a', cyclomatic_complexity: 12, call_chain_depth: 0, has_nested_loops: false }],
    ])
    render(
      <GraphCanvas
        nodes={[makeNode('a')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        complexityByNodeId={complexityByNodeId}
      />,
    )

    expect(screen.getByText('a')).toHaveStyle({ background: COMPLEX_COLOR })
  })

  it('falls back to the normal kind color for a node with no complexity score', () => {
    const complexityByNodeId = new Map<string, ComplexityScore>()
    render(
      <GraphCanvas
        nodes={[makeNode('a')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        complexityByNodeId={complexityByNodeId}
      />,
    )

    expect(screen.getByText('a')).toHaveStyle({ background: KIND_COLORS.function.background })
  })

  it('does not tint anything when complexityByNodeId is not set', () => {
    render(<GraphCanvas nodes={[makeNode('a')]} edges={[]} selectedNodeId={null} {...noop} />)

    expect(screen.getByText('a')).toHaveStyle({ background: KIND_COLORS.function.background })
  })

  it('auto-saves positions on an interval', () => {
    vi.useFakeTimers()
    try {
      const onAutoSavePositions = vi.fn()
      render(
        <GraphCanvas
          nodes={[makeNode('a')]}
          edges={[]}
          selectedNodeId={null}
          {...noop}
          onAutoSavePositions={onAutoSavePositions}
        />,
      )

      expect(onAutoSavePositions).not.toHaveBeenCalled()

      vi.advanceTimersByTime(AUTO_SAVE_POSITIONS_INTERVAL_MS)

      expect(onAutoSavePositions).toHaveBeenCalledTimes(1)
      expect(onAutoSavePositions).toHaveBeenCalledWith({ a: { x: 0, y: 0 } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes current positions once more on unmount, beyond the interval ticks', () => {
    const onAutoSavePositions = vi.fn()
    const { unmount } = render(
      <GraphCanvas
        nodes={[makeNode('a')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        onAutoSavePositions={onAutoSavePositions}
      />,
    )

    expect(onAutoSavePositions).not.toHaveBeenCalled()

    unmount()

    // A drag made right before switching away from this view (which
    // remounts GraphCanvas with a fresh key) would otherwise be lost
    // until the next 60s tick, which never comes for the old instance.
    expect(onAutoSavePositions).toHaveBeenCalledTimes(1)
    expect(onAutoSavePositions).toHaveBeenCalledWith({ a: { x: 0, y: 0 } })
  })

  // Edge highlighting (dimming edges outside the highlight set, restoring
  // each edge's own base opacity once a highlight clears) is exercised by
  // the same effect as node highlighting below, but isn't itself
  // DOM-asserted here: @xyflow/react only renders an edge once its
  // source/target nodes report measured dimensions via ResizeObserver,
  // which the test environment's ResizeObserver stub (src/test/setup.ts)
  // never fires, so no edge ever mounts in jsdom regardless of props.
  it('dims nodes outside the highlight set, leaving highlighted ones untouched', () => {
    render(
      <GraphCanvas
        nodes={[makeNode('a'), makeNode('b'), makeNode('c')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        highlight={{ nodeIds: new Set(['a', 'b']), edgeKeys: new Set(['a->b']) }}
      />,
    )

    expect(screen.getByTestId('rf__node-a')).toHaveStyle({ opacity: '1' })
    expect(screen.getByTestId('rf__node-b')).toHaveStyle({ opacity: '1' })
    expect(screen.getByTestId('rf__node-c')).toHaveStyle({ opacity: '0.25' })
  })

  it('keeps highlighting and selection intact when the nodes/edges props are replaced by new-but-equivalent objects', () => {
    // Regression test: a parent recomputing an unrelated bit of state
    // (e.g. selecting a different node) must not, by itself, cause a new
    // `nodes`/`edges` array to reset which node looks selected/highlighted
    // -- selection and highlight are derived from `selectedNodeId` and
    // `highlight` on every render, not written once into node/edge state,
    // so a fresh (but same-content) `nodes` prop can't leave them stale.
    const { rerender } = render(
      <GraphCanvas
        nodes={[makeNode('a'), makeNode('b')]}
        edges={[]}
        selectedNodeId="a"
        {...noop}
        highlight={{ nodeIds: new Set(['a']), edgeKeys: new Set([]) }}
      />,
    )
    expect(screen.getByTestId('rf__node-a')).toHaveStyle({ opacity: '1' })
    expect(screen.getByTestId('rf__node-b')).toHaveStyle({ opacity: '0.25' })

    // Same ids/content, but brand new array and object references --
    // simulating a parent's memo recomputing for an unrelated reason.
    rerender(
      <GraphCanvas
        nodes={[makeNode('a'), makeNode('b')]}
        edges={[]}
        selectedNodeId="a"
        {...noop}
        highlight={{ nodeIds: new Set(['a']), edgeKeys: new Set([]) }}
      />,
    )

    expect(screen.getByTestId('rf__node-a')).toHaveStyle({ opacity: '1' })
    expect(screen.getByTestId('rf__node-b')).toHaveStyle({ opacity: '0.25' })
  })

  it('restores full node opacity once a highlight clears', () => {
    const { rerender } = render(
      <GraphCanvas
        nodes={[makeNode('a'), makeNode('b')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        highlight={{ nodeIds: new Set(['a']), edgeKeys: new Set([]) }}
      />,
    )
    expect(screen.getByTestId('rf__node-b')).toHaveStyle({ opacity: '0.25' })

    rerender(
      <GraphCanvas
        nodes={[makeNode('a'), makeNode('b')]}
        edges={[]}
        selectedNodeId={null}
        {...noop}
        highlight={null}
      />,
    )

    expect(screen.getByTestId('rf__node-b')).toHaveStyle({ opacity: '1' })
  })

  it('does not auto-save when no callback is provided', () => {
    vi.useFakeTimers()
    try {
      expect(() => {
        render(<GraphCanvas nodes={[makeNode('a')]} edges={[]} selectedNodeId={null} {...noop} />)
        vi.advanceTimersByTime(AUTO_SAVE_POSITIONS_INTERVAL_MS * 2)
      }).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('edge-kind legend/filter', () => {
    it('does not render the legend when onToggleEdgeKind is not provided', () => {
      render(
        <GraphCanvas
          nodes={[makeNode('a'), makeNode('b')]}
          edges={[makeEdge('a', 'b', 'calls')]}
          selectedNodeId={null}
          {...noop}
        />,
      )

      expect(
        screen.queryByRole('group', { name: 'Edge kinds shown on the canvas' }),
      ).not.toBeInTheDocument()
    })

    it('renders one checked legend checkbox per edge kind present, when onToggleEdgeKind is provided', () => {
      render(
        <GraphCanvas
          nodes={[makeNode('a'), makeNode('b')]}
          edges={[makeEdge('a', 'b', 'calls'), makeEdge('a', 'b', 'imports')]}
          selectedNodeId={null}
          {...noop}
          onToggleEdgeKind={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('calls')).toBeChecked()
      expect(screen.getByLabelText('imports')).toBeChecked()
      expect(screen.queryByLabelText('defines')).not.toBeInTheDocument()
    })

    it('unchecks exactly the kind(s) in hiddenEdgeKinds, leaving others checked', () => {
      render(
        <GraphCanvas
          nodes={[makeNode('a'), makeNode('b')]}
          edges={[makeEdge('a', 'b', 'calls'), makeEdge('a', 'b', 'imports')]}
          selectedNodeId={null}
          {...noop}
          onToggleEdgeKind={vi.fn()}
          hiddenEdgeKinds={new Set(['imports'])}
        />,
      )

      expect(screen.getByLabelText('calls')).toBeChecked()
      expect(screen.getByLabelText('imports')).not.toBeChecked()
    })

    // Whether hiding a kind actually removes its lines from the canvas is
    // deliberately not asserted here via DOM queries: confirmed live
    // (writing the DOM to a file and inspecting it) that React Flow
    // renders zero `.react-flow__edge` elements in this jsdom test setup
    // regardless of filtering -- it needs real layout measurement of node
    // handle positions that jsdom can't provide, so this file has never
    // asserted on rendered edges at all (only node rendering and
    // `toFlowEdges`'s own output shape, in transform.test.ts). The
    // checkbox-state tests above already confirm `hiddenEdgeKinds` is
    // received and interpreted correctly by the same component; the
    // actual visual removal is verified live in a real browser instead
    // (see this milestone's manual verification).

    it('calls onToggleEdgeKind with the clicked kind', async () => {
      const onToggleEdgeKind = vi.fn()
      const user = userEvent.setup()
      render(
        <GraphCanvas
          nodes={[makeNode('a'), makeNode('b')]}
          edges={[makeEdge('a', 'b', 'calls')]}
          selectedNodeId={null}
          {...noop}
          onToggleEdgeKind={onToggleEdgeKind}
        />,
      )

      await user.click(screen.getByLabelText('calls'))

      expect(onToggleEdgeKind).toHaveBeenCalledWith('calls')
    })
  })
})
