import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GraphNode } from '../api/types'
import { DetailsPanel } from './DetailsPanel'

const node: GraphNode = {
  id: 'app.py::Greeter.greet',
  kind: 'function',
  label: 'greet',
  file: 'app.py',
  line_start: 6,
  line_end: 8,
}

describe('DetailsPanel', () => {
  it('shows a placeholder when nothing is selected', () => {
    render(<DetailsPanel selectedNode={null} pane={null} />)

    expect(screen.getByText(/select a node/i)).toBeInTheDocument()
  })

  it('shows the selected node metadata', () => {
    render(<DetailsPanel selectedNode={node} pane={null} />)

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
      />,
    )

    expect(screen.getByText('def greet(): ...')).toBeInTheDocument()
  })

  it('renders a source error', () => {
    render(
      <DetailsPanel selectedNode={node} pane={{ kind: 'source', status: 'error', message: 'boom' }} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders a stub message for unimplemented features', () => {
    render(<DetailsPanel selectedNode={node} pane={{ kind: 'stub', feature: 'Impact Analysis' }} />)

    expect(screen.getByText(/impact analysis is not implemented yet/i)).toBeInTheDocument()
  })
})
