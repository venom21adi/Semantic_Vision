import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Edge } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { GraphEdge } from '../api/types'
import { EdgeLegend } from './EdgeLegend'
import type { FlowEdgeData } from './transform'

function edge(kind: GraphEdge['kind']): Edge<FlowEdgeData> {
  return { id: `a->b:${kind}`, source: 'a', target: 'b', data: { kind, laneOffset: 0 } }
}

describe('EdgeLegend', () => {
  it('renders nothing when there are no edges', () => {
    const { container } = render(<EdgeLegend edges={[]} onToggleEdgeKind={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per distinct kind present, not the full static kind list', () => {
    render(<EdgeLegend edges={[edge('calls'), edge('calls'), edge('imports')]} onToggleEdgeKind={vi.fn()} />)

    expect(screen.getByLabelText('calls')).toBeInTheDocument()
    expect(screen.getByLabelText('imports')).toBeInTheDocument()
    expect(screen.queryByLabelText('defines')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('writes')).not.toBeInTheDocument()
  })

  it('checks every present kind by default (hiddenEdgeKinds omitted)', () => {
    render(<EdgeLegend edges={[edge('calls')]} onToggleEdgeKind={vi.fn()} />)

    expect(screen.getByLabelText('calls')).toBeChecked()
  })

  it('unchecks a kind that is in hiddenEdgeKinds', () => {
    render(
      <EdgeLegend
        edges={[edge('calls'), edge('imports')]}
        hiddenEdgeKinds={new Set(['imports'])}
        onToggleEdgeKind={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('calls')).toBeChecked()
    expect(screen.getByLabelText('imports')).not.toBeChecked()
  })

  it('calls onToggleEdgeKind with the row kind when its checkbox is clicked', async () => {
    const onToggleEdgeKind = vi.fn()
    const user = userEvent.setup()
    render(<EdgeLegend edges={[edge('calls')]} onToggleEdgeKind={onToggleEdgeKind} />)

    await user.click(screen.getByLabelText('calls'))

    expect(onToggleEdgeKind).toHaveBeenCalledWith('calls')
  })
})
