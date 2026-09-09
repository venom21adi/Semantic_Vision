import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DuplicateGroup, GraphNode } from '../api/types'
import { DuplicatesReportPane } from './DuplicatesReportPane'

describe('DuplicatesReportPane', () => {
  it('shows an empty-state message when there are no groups', () => {
    render(
      <DuplicatesReportPane groups={[]} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    expect(screen.getByText('No duplicate-function groups found.')).toBeInTheDocument()
  })

  it('renders one row per group, keyed by the first member', () => {
    const groups: DuplicateGroup[] = [
      { node_ids: ['app.py::foo', 'app.py::bar'], size: 2 },
    ]
    render(
      <DuplicatesReportPane groups={groups} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('app.py::foo')
    expect(buttons[0]).toHaveTextContent('2 similar functions')
    expect(buttons[0]).toHaveTextContent('app.py::bar')
  })

  it('calls onSelectNode with the group\'s first member when clicked', async () => {
    const user = userEvent.setup()
    const onSelectNode = vi.fn()
    const groups: DuplicateGroup[] = [{ node_ids: ['app.py::foo', 'app.py::bar'], size: 2 }]
    render(
      <DuplicatesReportPane
        groups={groups}
        graphNodes={[]}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />,
    )

    await user.click(screen.getByRole('button', { name: /app\.py::foo/ }))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::foo')
  })

  it('filters groups that match on any member, not just the first', async () => {
    const groups: DuplicateGroup[] = [
      { node_ids: ['app.py::foo', 'app.py::bar'], size: 2 },
      { node_ids: ['other.py::baz', 'other.py::qux'], size: 2 },
    ]
    const user = userEvent.setup()
    render(
      <DuplicatesReportPane groups={groups} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    await user.type(screen.getByLabelText('Filter functions'), 'bar')

    expect(screen.getByText(/app\.py::foo/)).toBeInTheDocument()
    expect(screen.queryByText(/other\.py::baz/)).not.toBeInTheDocument()
  })

  it('shows a no-match message when the filter excludes every group', async () => {
    const groups: DuplicateGroup[] = [{ node_ids: ['app.py::foo', 'app.py::bar'], size: 2 }]
    const user = userEvent.setup()
    render(
      <DuplicatesReportPane groups={groups} graphNodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />,
    )

    await user.type(screen.getByLabelText('Filter functions'), 'nonexistent')

    expect(screen.getByText('No groups match this filter.')).toBeInTheDocument()
  })

  it('shows the pretty name for a matching graph node instead of the raw id', () => {
    const groups: DuplicateGroup[] = [{ node_ids: ['app.py::foo', 'app.py::bar'], size: 2 }]
    const graphNodes: GraphNode[] = [
      { id: 'app.py::foo', kind: 'function', label: 'foo', file: 'app.py', line_start: 1, line_end: 2 },
    ]
    render(
      <DuplicatesReportPane
        groups={groups}
        graphNodes={graphNodes}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />,
    )

    expect(screen.getByText('foo')).toBeInTheDocument()
  })
})
