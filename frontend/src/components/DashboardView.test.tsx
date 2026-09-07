import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComplexityScore } from '../api/types'
import { DashboardView } from './DashboardView'

const scores: ComplexityScore[] = [
  { node_id: 'app.py::handler', cyclomatic_complexity: 4, call_chain_depth: 1, has_nested_loops: false },
]

describe('DashboardView', () => {
  it('shows a loading message', () => {
    render(
      <DashboardView state={{ status: 'loading' }} path="/repo" onSelectNode={vi.fn()} onBack={vi.fn()} />,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    render(
      <DashboardView
        state={{ status: 'error', message: 'boom' }}
        path="/repo"
        onSelectNode={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders the ranked report when loaded', () => {
    render(
      <DashboardView
        state={{ status: 'loaded', scores }}
        path="/repo"
        onSelectNode={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument()
    expect(screen.getByText(/app\.py::handler/)).toBeInTheDocument()
  })

  it('calls onBack when "Back to graph" is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <DashboardView
        state={{ status: 'loaded', scores }}
        path="/repo"
        onSelectNode={vi.fn()}
        onBack={onBack}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
