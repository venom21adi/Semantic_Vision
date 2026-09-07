import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComplexityDiffResponse, ComplexityScore } from '../api/types'
import { DashboardView } from './DashboardView'

const scores: ComplexityScore[] = [
  { node_id: 'app.py::handler', cyclomatic_complexity: 4, call_chain_depth: 1, has_nested_loops: false },
]

function renderDashboard(overrides: Partial<React.ComponentProps<typeof DashboardView>> = {}) {
  const props: React.ComponentProps<typeof DashboardView> = {
    state: { status: 'loaded', scores },
    path: '/repo',
    onSelectNode: vi.fn(),
    onBack: vi.fn(),
    diff: null,
    onCompare: vi.fn(),
    ...overrides,
  }
  return { ...render(<DashboardView {...props} />), props }
}

describe('DashboardView', () => {
  it('shows a loading message', () => {
    renderDashboard({ state: { status: 'loading' } })

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    renderDashboard({ state: { status: 'error', message: 'boom' } })

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders the ranked report when loaded', () => {
    renderDashboard()

    expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument()
    expect(screen.getByText(/app\.py::handler/)).toBeInTheDocument()
  })

  it('calls onBack when "Back to graph" is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderDashboard()

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))

    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('disables Compare while the dashboard itself is still loading', () => {
    renderDashboard({ state: { status: 'loading' } })

    expect(screen.getByRole('button', { name: 'Compare to last look' })).toBeDisabled()
  })

  it('calls onCompare when Compare to last look is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderDashboard()

    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))

    expect(props.onCompare).toHaveBeenCalledTimes(1)
  })

  it('disables Compare and shows a comparing label while a compare is in flight', () => {
    renderDashboard({ diff: { status: 'loading' } })

    const button = screen.getByRole('button', { name: 'Comparing…' })
    expect(button).toBeDisabled()
  })

  it('shows a comparing message in the results area while loading', () => {
    renderDashboard({ diff: { status: 'loading' } })

    expect(screen.getAllByText('Comparing…').length).toBeGreaterThan(0)
  })

  it('shows a diff error message', () => {
    renderDashboard({ diff: { status: 'error', message: 'diff boom' } })

    expect(screen.getByRole('alert')).toHaveTextContent('diff boom')
  })

  it('shows a no-baseline note when the diff is unavailable', () => {
    const result: ComplexityDiffResponse = { available: false, current: scores, added: [], removed: [], changed: [] }
    renderDashboard({ diff: { status: 'loaded', result } })

    expect(screen.getByText(/No earlier snapshot/)).toBeInTheDocument()
  })

  it('shows a no-changes message when nothing changed', () => {
    const result: ComplexityDiffResponse = { available: true, current: scores, added: [], removed: [], changed: [] }
    renderDashboard({ diff: { status: 'loaded', result } })

    expect(screen.getByText('No changes since the last look.')).toBeInTheDocument()
  })

  it('renders added, removed, and changed sections and only removed rows are non-clickable', async () => {
    const user = userEvent.setup()
    const result: ComplexityDiffResponse = {
      available: true,
      current: scores,
      added: [
        { node_id: 'app.py::new_fn', cyclomatic_complexity: 2, call_chain_depth: 0, has_nested_loops: false },
      ],
      removed: [
        { node_id: 'app.py::gone_fn', cyclomatic_complexity: 3, call_chain_depth: 0, has_nested_loops: false },
      ],
      changed: [
        {
          node_id: 'app.py::handler',
          before: { node_id: 'app.py::handler', cyclomatic_complexity: 2, call_chain_depth: 0, has_nested_loops: false },
          after: { node_id: 'app.py::handler', cyclomatic_complexity: 4, call_chain_depth: 1, has_nested_loops: false },
        },
      ],
    }
    const { props } = renderDashboard({ diff: { status: 'loaded', result } })

    expect(screen.getByText(/Added/)).toBeInTheDocument()
    expect(screen.getByText(/Removed/)).toBeInTheDocument()
    expect(screen.getByText(/Changed/)).toBeInTheDocument()

    // Removed entries render as plain text, not a clickable button --
    // selecting a node that no longer exists would silently do nothing.
    expect(screen.queryByRole('button', { name: /gone_fn/ })).not.toBeInTheDocument()
    expect(screen.getByText(/app\.py::gone_fn/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /new_fn/ }))
    expect(props.onSelectNode).toHaveBeenCalledWith('app.py::new_fn')
  })
})
