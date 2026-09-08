import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DeadCodeCandidate, GraphNode } from '../api/types'
import { DeadCodeReportPane } from './DeadCodeReportPane'

describe('DeadCodeReportPane', () => {
  it('shows an empty-state message when there are no candidates', () => {
    render(
      <DeadCodeReportPane candidates={[]} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    expect(screen.getByText('No dead-code candidates found.')).toBeInTheDocument()
  })

  it('renders a row per candidate and calls onSelectNode when clicked', async () => {
    const candidates: DeadCodeCandidate[] = [{ node_id: 'app.py::orphan' }]
    const onSelectNode = vi.fn()
    const user = userEvent.setup()
    render(
      <DeadCodeReportPane
        candidates={candidates}
        graphNodes={[]}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />,
    )

    await user.click(screen.getByRole('button', { name: /app\.py::orphan/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::orphan')
  })

  it('shows the pretty name and file path when a matching graph node exists', () => {
    const candidates: DeadCodeCandidate[] = [{ node_id: 'app.py::orphan' }]
    const graphNodes: GraphNode[] = [
      { id: 'app.py::orphan', kind: 'function', label: 'orphan', file: 'app.py', line_start: 1, line_end: 2 },
    ]
    render(
      <DeadCodeReportPane
        candidates={candidates}
        graphNodes={graphNodes}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    expect(screen.getByText('orphan')).toBeInTheDocument()
    expect(screen.getByText('app.py')).toBeInTheDocument()
  })

  it('filters candidates by name/file search', async () => {
    const candidates: DeadCodeCandidate[] = [{ node_id: 'app.py::orphan' }, { node_id: 'app.py::gone' }]
    const user = userEvent.setup()
    render(
      <DeadCodeReportPane
        candidates={candidates}
        graphNodes={[]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Filter functions'), 'orphan')

    expect(screen.getByText(/app\.py::orphan/)).toBeInTheDocument()
    expect(screen.queryByText(/app\.py::gone/)).not.toBeInTheDocument()
  })

  it('shows a no-match message when the filter excludes every candidate', async () => {
    const candidates: DeadCodeCandidate[] = [{ node_id: 'app.py::orphan' }]
    const user = userEvent.setup()
    render(
      <DeadCodeReportPane
        candidates={candidates}
        graphNodes={[]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Filter functions'), 'nonexistent')

    expect(screen.getByText('No candidates match this filter.')).toBeInTheDocument()
  })
})
