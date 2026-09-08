import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HotspotScore } from '../api/types'
import { HotspotReportPane } from './HotspotReportPane'

describe('HotspotReportPane', () => {
  it('shows an empty-state message when there are no scores', () => {
    render(<HotspotReportPane scores={[]} onSelectNode={vi.fn()} />)

    expect(screen.getByText('No functions found.')).toBeInTheDocument()
  })

  it('renders each score in the given (already-sorted) order', () => {
    const scores: HotspotScore[] = [
      { node_id: 'app.py::hot', cyclomatic_complexity: 4, change_count: 5, hotspot_score: 20 },
      { node_id: 'app.py::cold', cyclomatic_complexity: 2, change_count: 1, hotspot_score: 2 },
    ]
    render(<HotspotReportPane scores={scores} onSelectNode={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent('app.py::hot')
    expect(buttons[1]).toHaveTextContent('app.py::cold')
    expect(buttons[0]).toHaveTextContent('hotspot 20')
    expect(buttons[0]).toHaveTextContent('changed 5×')
  })

  it('calls onSelectNode when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectNode = vi.fn()
    const scores: HotspotScore[] = [
      { node_id: 'app.py::hot', cyclomatic_complexity: 4, change_count: 5, hotspot_score: 20 },
    ]
    render(<HotspotReportPane scores={scores} onSelectNode={onSelectNode} />)

    await user.click(screen.getByRole('button', { name: /app\.py::hot/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::hot')
  })
})
