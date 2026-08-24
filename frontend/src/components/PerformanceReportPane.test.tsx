import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import type { ComplexityScore, ImpactResponse } from '../api/types'
import { PerformanceReportPane } from './PerformanceReportPane'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, getImpact: vi.fn() }
})

const mockedClient = vi.mocked(client)

const scores: ComplexityScore[] = [
  { node_id: 'app.py::simple', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false },
  {
    node_id: 'app.py::complex',
    cyclomatic_complexity: 12,
    call_chain_depth: 2,
    has_nested_loops: true,
  },
]

describe('PerformanceReportPane', () => {
  it('shows a message when there are no functions', () => {
    render(<PerformanceReportPane path="/repo" scores={[]} onSelectNode={vi.fn()} />)

    expect(screen.getByText(/no functions found/i)).toBeInTheDocument()
  })

  it('ranks functions by complexity, highest first', () => {
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('app.py::complex')
    expect(items[1]).toHaveTextContent('app.py::simple')
  })

  it('flags nested loops on the ranked entry', () => {
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    expect(screen.getByText(/nested loops/i)).toBeInTheDocument()
  })

  it('shows call chain depth on the ranked entry only when it is nonzero', () => {
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    // "complex" has call_chain_depth: 2, "simple" has call_chain_depth: 0.
    expect(screen.getByText(/call depth 2/)).toBeInTheDocument()
    expect(screen.queryByText(/call depth 0/)).not.toBeInTheDocument()
  })

  it('shows a legend explaining the complexity bands', () => {
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    expect(screen.getByText(/simple \(1–3\)/i)).toBeInTheDocument()
    expect(screen.getByText(/moderate \(4–7\)/i)).toBeInTheDocument()
    expect(screen.getByText(/complex \(8\+\)/i)).toBeInTheDocument()
  })

  it('calls onSelectNode when a ranked entry is clicked', async () => {
    const onSelectNode = vi.fn()
    const user = userEvent.setup()
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={onSelectNode} />)

    await user.click(screen.getByRole('button', { name: /^app\.py::complex/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::complex')
  })

  it('drills down into direct callers, cross-referenced with their own scores', async () => {
    const impact: ImpactResponse = {
      target: 'app.py::complex',
      callers: [
        { id: 'app.py::simple', depth: 1, direct: true },
        { id: 'app.py::transitive', depth: 2, direct: false },
      ],
      edges: [],
      cycles: [],
    }
    mockedClient.getImpact.mockResolvedValue(impact)
    const user = userEvent.setup()
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /show callers of app\.py::complex/i }))

    expect(mockedClient.getImpact).toHaveBeenCalledWith('/repo', 'app.py::complex')
    await waitFor(() =>
      expect(screen.getByText(/app\.py::simple \(complexity 1\)/)).toBeInTheDocument(),
    )
    // Transitive caller is excluded -- drill-down is direct callers only.
    expect(screen.queryByText(/transitive/)).not.toBeInTheDocument()
    // Labeled explicitly as callers, not callees, since that's a real
    // point of confusion (the build plan originally called for callees).
    expect(screen.getByText(/direct callers/i)).toBeInTheDocument()
  })

  it('shows a message when a function has no direct callers', async () => {
    mockedClient.getImpact.mockResolvedValue({
      target: 'app.py::complex',
      callers: [],
      edges: [],
      cycles: [],
    })
    const user = userEvent.setup()
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /show callers of app\.py::complex/i }))

    await waitFor(() => expect(screen.getByText(/no direct callers/i)).toBeInTheDocument())
  })

  it('collapses the drill-down when clicked again', async () => {
    mockedClient.getImpact.mockResolvedValue({
      target: 'app.py::complex',
      callers: [{ id: 'app.py::simple', depth: 1, direct: true }],
      edges: [],
      cycles: [],
    })
    const user = userEvent.setup()
    render(<PerformanceReportPane path="/repo" scores={scores} onSelectNode={vi.fn()} />)

    const toggle = screen.getByRole('button', { name: /show callers of app\.py::complex/i })
    await user.click(toggle)
    await waitFor(() =>
      expect(screen.getByText(/app\.py::simple \(complexity 1\)/)).toBeInTheDocument(),
    )

    await user.click(toggle)

    expect(screen.queryByText(/app\.py::simple \(complexity 1\)/)).not.toBeInTheDocument()
  })
})
