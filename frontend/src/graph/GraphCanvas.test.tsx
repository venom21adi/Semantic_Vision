import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { AUTO_SAVE_POSITIONS_INTERVAL_MS, GraphCanvas, LARGE_GRAPH_NODE_THRESHOLD } from './GraphCanvas'
import type { GraphNodeData } from './nodeTypes'

function makeNode(id: string, kind: GraphNodeData['kind'] = 'function'): Node<GraphNodeData> {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { label: id, kind, file: 'app.py', lineStart: 1, lineEnd: 2 },
  }
}

const noop = {
  onSelectNode: vi.fn(),
  onDocument: vi.fn(),
  onImpactAnalysis: vi.fn(),
  onViewSource: vi.fn(),
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
})
