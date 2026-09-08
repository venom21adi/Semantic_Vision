import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HotspotScore } from '../api/types'
import { HotspotReportPane } from './HotspotReportPane'

describe('HotspotReportPane', () => {
  it('shows an empty-state message when there are no scores', () => {
    render(<HotspotReportPane scores={[]} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    expect(screen.getByText('No functions found.')).toBeInTheDocument()
  })

  it('renders each score in the given (already-sorted) order', () => {
    const scores: HotspotScore[] = [
      { node_id: 'app.py::hot', cyclomatic_complexity: 4, change_count: 5, hotspot_score: 20 },
      { node_id: 'app.py::cold', cyclomatic_complexity: 2, change_count: 1, hotspot_score: 2 },
    ]
    render(<HotspotReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent('app.py::hot')
    expect(buttons[1]).toHaveTextContent('app.py::cold')
    expect(buttons[0]).toHaveTextContent('Hotspot 20')
    expect(buttons[0]).toHaveTextContent('Changed 5×')
  })

  it('calls onSelectNode when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectNode = vi.fn()
    const scores: HotspotScore[] = [
      { node_id: 'app.py::hot', cyclomatic_complexity: 4, change_count: 5, hotspot_score: 20 },
    ]
    render(<HotspotReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={onSelectNode} />)

    await user.click(screen.getByRole('button', { name: /app\.py::hot/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::hot')
  })

  it('filters out rows that do not match the name/file search', async () => {
    const scores: HotspotScore[] = [
      { node_id: 'app.py::hot', cyclomatic_complexity: 4, change_count: 5, hotspot_score: 20 },
      { node_id: 'app.py::cold', cyclomatic_complexity: 2, change_count: 1, hotspot_score: 2 },
    ]
    const user = userEvent.setup()
    render(<HotspotReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    await user.type(screen.getByLabelText('Filter functions'), 'hot')

    expect(screen.getByText(/app\.py::hot/)).toBeInTheDocument()
    expect(screen.queryByText(/app\.py::cold/)).not.toBeInTheDocument()
  })

  it('re-sorts by times-changed when the sort selector changes', async () => {
    // Hotspot-score order (hot=20, warm=3) is the reverse of change-count
    // order (warm changed more often), proving the selector re-sorted.
    const scores: HotspotScore[] = [
      { node_id: 'app.py::hot', cyclomatic_complexity: 4, change_count: 1, hotspot_score: 20 },
      { node_id: 'app.py::warm', cyclomatic_complexity: 1, change_count: 9, hotspot_score: 3 },
    ]
    const user = userEvent.setup()
    render(<HotspotReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    expect(screen.getAllByRole('button')[0]).toHaveTextContent('app.py::hot')

    await user.selectOptions(screen.getByLabelText('Sort functions'), 'changes-desc')

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('app.py::warm')
    expect(buttons[1]).toHaveTextContent('app.py::hot')
  })
})
