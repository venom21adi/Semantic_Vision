import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, ImpactResponse } from '../api/types'
import { DetailsPanel } from './DetailsPanel'

const node: GraphNode = {
  id: 'app.py::Greeter.greet',
  kind: 'function',
  label: 'greet',
  file: 'app.py',
  line_start: 6,
  line_end: 8,
}

const noop = vi.fn()

describe('DetailsPanel', () => {
  it('shows a placeholder when nothing is selected', () => {
    render(<DetailsPanel selectedNode={null} pane={null} onSelectCaller={noop} />)

    expect(screen.getByText(/select a node/i)).toBeInTheDocument()
  })

  it('shows the selected node metadata', () => {
    render(<DetailsPanel selectedNode={node} pane={null} onSelectCaller={noop} />)

    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
    expect(screen.getByText('function')).toBeInTheDocument()
    expect(screen.getByText('app.py')).toBeInTheDocument()
    expect(screen.getByText('6-8')).toBeInTheDocument()
  })

  it('renders loaded source', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'source', status: 'loaded', source: 'def greet(): ...' }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByText('def greet(): ...')).toBeInTheDocument()
  })

  it('renders a source error', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'source', status: 'error', message: 'boom' }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders loaded documentation', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet' }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByText('# greet')).toBeInTheDocument()
  })

  it('renders a not-found message when no documentation is saved', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'doc', status: 'not-found' }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument()
  })

  it('renders a doc error', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'doc', status: 'error', message: 'boom' }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders a no-callers message for impact analysis with nothing found', () => {
    const result: ImpactResponse = { target: node.id, callers: [], edges: [], cycles: [] }
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'impact', status: 'loaded', result }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByText(/no callers found/i)).toBeInTheDocument()
  })

  it('renders direct and transitive callers, grouped, and a cycle warning', () => {
    const result: ImpactResponse = {
      target: node.id,
      callers: [
        { id: 'a.py::caller_direct', depth: 1, direct: true },
        { id: 'b.py::caller_transitive', depth: 2, direct: false },
      ],
      edges: [],
      cycles: [[node.id, 'a.py::caller_direct']],
    }
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'impact', status: 'loaded', result }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByText('Direct callers')).toBeInTheDocument()
    expect(screen.getByText('Transitive callers')).toBeInTheDocument()
    expect(screen.getByText(/a\.py::caller_direct/)).toBeInTheDocument()
    expect(screen.getByText(/b\.py::caller_transitive/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/circular call chain/i)
  })

  it('calls onSelectCaller when a caller is clicked', async () => {
    const onSelectCaller = vi.fn()
    const result: ImpactResponse = {
      target: node.id,
      callers: [{ id: 'a.py::caller_direct', depth: 1, direct: true }],
      edges: [],
      cycles: [],
    }
    const user = userEvent.setup()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'impact', status: 'loaded', result }}
        onSelectCaller={onSelectCaller}
      />,
    )

    await user.click(screen.getByText(/a\.py::caller_direct/))

    expect(onSelectCaller).toHaveBeenCalledWith('a.py::caller_direct')
  })

  it('renders an impact analysis error', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'impact', status: 'error', message: 'boom' }}
        onSelectCaller={noop}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })
})
