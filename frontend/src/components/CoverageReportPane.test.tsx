import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CoverageRiskScore } from '../api/types'
import { CoverageReportPane } from './CoverageReportPane'

describe('CoverageReportPane', () => {
  it('shows an empty-state message when there are no scores', () => {
    render(<CoverageReportPane scores={[]} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    expect(screen.getByText('No functions found.')).toBeInTheDocument()
  })

  it('renders each score in the given (already-sorted) order', () => {
    const scores: CoverageRiskScore[] = [
      {
        node_id: 'app.py::risky',
        cyclomatic_complexity: 6,
        blast_radius: 2,
        coverage_ratio: 0,
        risk_score: 18,
      },
      {
        node_id: 'app.py::safe',
        cyclomatic_complexity: 1,
        blast_radius: 0,
        coverage_ratio: 1,
        risk_score: 0,
      },
    ]
    render(<CoverageReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent('app.py::risky')
    expect(buttons[1]).toHaveTextContent('app.py::safe')
    expect(buttons[0]).toHaveTextContent('Coverage 0%')
    expect(buttons[0]).toHaveTextContent('Blast radius 2')
  })

  it('shows "No coverage data" for a null coverage_ratio, not "0%"', () => {
    const scores: CoverageRiskScore[] = [
      {
        node_id: 'app.py::unmeasured',
        cyclomatic_complexity: 2,
        blast_radius: 0,
        coverage_ratio: null,
        risk_score: 2,
      },
    ]
    render(<CoverageReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    expect(screen.getByText('No coverage data')).toBeInTheDocument()
    expect(screen.queryByText('Coverage 0%')).not.toBeInTheDocument()
  })

  it('calls onSelectNode when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectNode = vi.fn()
    const scores: CoverageRiskScore[] = [
      {
        node_id: 'app.py::risky',
        cyclomatic_complexity: 6,
        blast_radius: 2,
        coverage_ratio: 0,
        risk_score: 18,
      },
    ]
    render(
      <CoverageReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={onSelectNode} />,
    )

    await user.click(screen.getByRole('button', { name: /app\.py::risky/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::risky')
  })

  it('filters out rows that do not match the name/file search', async () => {
    const scores: CoverageRiskScore[] = [
      {
        node_id: 'app.py::risky',
        cyclomatic_complexity: 6,
        blast_radius: 2,
        coverage_ratio: 0,
        risk_score: 18,
      },
      {
        node_id: 'app.py::safe',
        cyclomatic_complexity: 1,
        blast_radius: 0,
        coverage_ratio: 1,
        risk_score: 0,
      },
    ]
    const user = userEvent.setup()
    render(<CoverageReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    await user.type(screen.getByLabelText('Filter functions'), 'risky')

    expect(screen.getByText(/app\.py::risky/)).toBeInTheDocument()
    expect(screen.queryByText(/app\.py::safe/)).not.toBeInTheDocument()
  })

  it('re-sorts by least-covered when the sort selector changes', async () => {
    // Risk-score order (risky=5, mild=4) doesn't match coverage-ascending
    // order (risky has more coverage than mild), proving the selector
    // actually re-sorted rather than leaving the default order in place.
    const scores: CoverageRiskScore[] = [
      {
        node_id: 'app.py::risky',
        cyclomatic_complexity: 5,
        blast_radius: 0,
        coverage_ratio: 0.5,
        risk_score: 5,
      },
      {
        node_id: 'app.py::mild',
        cyclomatic_complexity: 4,
        blast_radius: 0,
        coverage_ratio: 0,
        risk_score: 4,
      },
    ]
    const user = userEvent.setup()
    render(<CoverageReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    expect(screen.getAllByRole('button')[0]).toHaveTextContent('app.py::risky')

    await user.selectOptions(screen.getByLabelText('Sort functions'), 'coverage-asc')

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('app.py::mild')
    expect(buttons[1]).toHaveTextContent('app.py::risky')
  })
})
