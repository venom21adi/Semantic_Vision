import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { FlowchartCanvas, LARGE_FLOWCHART_NODE_THRESHOLD } from './FlowchartCanvas'
import type { FlowNodeData } from './nodeTypes'

function makeNode(id: string, kind: FlowNodeData['kind'] = 'statement'): Node<FlowNodeData> {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { label: id, kind, line: 1, endLine: 1 },
  }
}

describe('FlowchartCanvas', () => {
  it('shows the target label in the header', () => {
    render(
      <FlowchartCanvas targetLabel="greet" nodes={[makeNode('a')]} edges={[]} onBack={vi.fn()} />,
    )

    expect(screen.getByText('Execution flowchart: greet')).toBeInTheDocument()
  })

  it('renders node labels', () => {
    render(
      <FlowchartCanvas
        targetLabel="greet"
        nodes={[makeNode('a'), makeNode('b')]}
        edges={[]}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('calls onBack when "Back to graph" is clicked', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(
      <FlowchartCanvas targetLabel="greet" nodes={[makeNode('a')]} edges={[]} onBack={onBack} />,
    )

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows a warning banner above the node-count threshold', () => {
    const nodes = Array.from({ length: LARGE_FLOWCHART_NODE_THRESHOLD + 1 }, (_, i) =>
      makeNode(`n${i}`),
    )
    render(<FlowchartCanvas targetLabel="greet" nodes={nodes} edges={[]} onBack={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(`${LARGE_FLOWCHART_NODE_THRESHOLD + 1} nodes`)
  })

  it('does not show a warning banner at or below the threshold', () => {
    const nodes = Array.from({ length: LARGE_FLOWCHART_NODE_THRESHOLD }, (_, i) => makeNode(`n${i}`))
    render(<FlowchartCanvas targetLabel="greet" nodes={nodes} edges={[]} onBack={vi.fn()} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
