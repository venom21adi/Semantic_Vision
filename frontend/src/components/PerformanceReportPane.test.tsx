import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComplexityScore, GraphNode } from '../api/types'
import { PerformanceReportPane } from './PerformanceReportPane'

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
    render(<PerformanceReportPane scores={[]} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />)

    expect(screen.getByText(/no functions found/i)).toBeInTheDocument()
  })

  it('ranks functions by complexity, highest first', () => {
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('app.py::complex')
    expect(items[1]).toHaveTextContent('app.py::simple')
  })

  it('flags nested loops on the ranked entry', () => {
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    expect(screen.getByText(/nested loops/i)).toBeInTheDocument()
  })

  it('shows call chain depth on the ranked entry only when it is nonzero', () => {
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    // "complex" has call_chain_depth: 2, "simple" has call_chain_depth: 0.
    expect(screen.getByText(/depth 2/i)).toBeInTheDocument()
    expect(screen.queryByText(/depth 0/i)).not.toBeInTheDocument()
  })

  it('shows a legend explaining the complexity bands', () => {
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    expect(screen.getByText(/simple \(1–3\)/i)).toBeInTheDocument()
    expect(screen.getByText(/moderate \(4–7\)/i)).toBeInTheDocument()
    expect(screen.getByText(/complex \(8\+\)/i)).toBeInTheDocument()
  })

  it('calls onSelectNode when a ranked entry is clicked', async () => {
    const onSelectNode = vi.fn()
    const user = userEvent.setup()
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={onSelectNode} />,
    )

    await user.click(screen.getByRole('button', { name: /^app\.py::complex/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::complex')
  })

  it('shows the pretty name and file path when a matching graph node exists', () => {
    const graphNodes: GraphNode[] = [
      { id: 'app.py::complex', kind: 'function', label: 'complex', file: 'app.py', line_start: 1, line_end: 2 },
    ]
    render(
      <PerformanceReportPane
        scores={scores}
        graphNodes={graphNodes}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    expect(screen.getByText('complex')).toBeInTheDocument()
    expect(screen.getAllByText('app.py').length).toBeGreaterThan(0)
  })

  it('filters out functions that do not match the name/file search', async () => {
    const user = userEvent.setup()
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    await user.type(screen.getByLabelText('Filter functions'), 'simple')

    expect(screen.getByText(/app\.py::simple/)).toBeInTheDocument()
    expect(screen.queryByText(/app\.py::complex/)).not.toBeInTheDocument()
  })

  it('filters by complexity tier', async () => {
    const user = userEvent.setup()
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    await user.selectOptions(screen.getByLabelText('Filter by complexity'), 'simple')

    expect(screen.getByText(/app\.py::simple/)).toBeInTheDocument()
    expect(screen.queryByText(/app\.py::complex/)).not.toBeInTheDocument()
  })

  it('filters by minimum call depth', async () => {
    const user = userEvent.setup()
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    await user.clear(screen.getByLabelText('Minimum call depth'))
    await user.type(screen.getByLabelText('Minimum call depth'), '1')

    expect(screen.getByText(/app\.py::complex/)).toBeInTheDocument()
    expect(screen.queryByText(/app\.py::simple/)).not.toBeInTheDocument()
  })

  it('shows a no-match message when a filter excludes every row', async () => {
    const user = userEvent.setup()
    render(
      <PerformanceReportPane scores={scores} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    await user.type(screen.getByLabelText('Filter functions'), 'nonexistent-name')

    expect(screen.getByText('No functions match this filter.')).toBeInTheDocument()
  })

  it('re-sorts by name when the sort selector changes', async () => {
    // Complexity order (zeta=12, alpha=1) is the reverse of name order --
    // proving the selector actually changed the sort, not coincidentally
    // matching the default.
    const nameOrderedScores: ComplexityScore[] = [
      { node_id: 'app.py::zeta', cyclomatic_complexity: 12, call_chain_depth: 0, has_nested_loops: false },
      { node_id: 'app.py::alpha', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false },
    ]
    const user = userEvent.setup()
    render(
      <PerformanceReportPane
        scores={nameOrderedScores}
        graphNodes={[]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('app.py::zeta')

    await user.selectOptions(screen.getByLabelText('Sort functions'), 'name')

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('app.py::alpha')
    expect(items[1]).toHaveTextContent('app.py::zeta')
  })
})
