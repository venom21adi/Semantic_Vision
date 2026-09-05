import { fireEvent, render, screen } from '@testing-library/react'
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
const docProps = {
  docProvider: 'ollama' as const,
  onDocProviderChange: noop,
  ollamaModels: [] as string[],
  ollamaModelsLoading: false,
  ollamaModel: '',
  onOllamaModelChange: noop,
  onRefreshOllamaModels: noop,
  onGenerateDoc: noop,
  onSaveDoc: noop,
  onEditDoc: noop,
  docRoot: '/repo',
  repoPath: '/repo',
  docSaveNoticeDismissed: true,
  onDismissDocSaveNotice: noop,
  onDataSourceIngestComplete: noop,
}

describe('DetailsPanel', () => {
  it('shows a placeholder when nothing is selected', () => {
    render(
      <DetailsPanel
        selectedNode={null}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByText(/select a node/i)).toBeInTheDocument()
  })

  it('suggests showcase functions instead of the plain placeholder when given some', () => {
    const onTryShowcase = vi.fn()
    render(
      <DetailsPanel
        selectedNode={null}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        showcaseItems={[
          { id: 'services/orders.py::transition_order_status', label: 'transition_order_status' },
          { id: 'services/customers.py::flag_high_value_customers', label: 'flag_high_value_customers' },
        ]}
        onTryShowcase={onTryShowcase}
      />,
    )

    expect(screen.queryByText(/select a node/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'transition_order_status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'flag_high_value_customers' })).toBeInTheDocument()
  })

  it('calls onTryShowcase with the node id when a suggestion is clicked', async () => {
    const onTryShowcase = vi.fn()
    const user = userEvent.setup()
    render(
      <DetailsPanel
        selectedNode={null}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        showcaseItems={[
          { id: 'services/orders.py::transition_order_status', label: 'transition_order_status' },
        ]}
        onTryShowcase={onTryShowcase}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'transition_order_status' }))

    expect(onTryShowcase).toHaveBeenCalledWith('services/orders.py::transition_order_status')
  })

  it('shows the selected node metadata', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
    expect(screen.getByText('function')).toBeInTheDocument()
    expect(screen.getByText('app.py')).toBeInTheDocument()
    expect(screen.getByText('6-8')).toBeInTheDocument()
  })

  it('renders loaded source, syntax-highlighted by file extension', () => {
    const { container } = render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'source', status: 'loaded', source: 'def greet(): ...' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    // Highlighting fragments the text across several `<span>`s (`def` gets
    // its own keyword span), so a plain `getByText` for the whole line
    // wouldn't match any single node -- assert on the code block's overall
    // text content instead, and that it actually got tagged for the
    // language `app.py`'s extension implies.
    const code = container.querySelector('code')
    expect(code).toHaveTextContent('def greet(): ...')
    expect(code).toHaveClass('language-python')
    expect(code?.querySelector('.hljs-keyword')).toHaveTextContent('def')
  })

  it('falls back to plain (but still escaped) text for an unrecognized file extension', () => {
    const { container } = render(
      <DetailsPanel
        selectedNode={{ ...node, file: 'notes.txt' }}
        pane={{ kind: 'source', status: 'loaded', source: '<not html>' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    const code = container.querySelector('code')
    expect(code).toHaveTextContent('<not html>')
    expect(code?.className ?? '').not.toMatch(/language-/)
    expect(code?.innerHTML).toContain('&lt;not html&gt;')
  })

  it('renders a source error', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'source', status: 'error', message: 'boom' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders loaded documentation as rendered markdown', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: true }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument()
  })

  it('renders a not-found message when no documentation is saved', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'doc', status: 'not-found' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
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
        onClosePane={noop}
        {...docProps}
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
        onClosePane={noop}
        {...docProps}
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
        onClosePane={noop}
        {...docProps}
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
        onClosePane={noop}
        {...docProps}
      />,
    )

    await user.click(screen.getByText(/a\.py::caller_direct/))

    expect(onSelectCaller).toHaveBeenCalledWith('a.py::caller_direct')
  })

  it('calls onClosePane when the pane close button is clicked', async () => {
    const onClosePane = vi.fn()
    const result: ImpactResponse = { target: node.id, callers: [], edges: [], cycles: [] }
    const user = userEvent.setup()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'impact', status: 'loaded', result }}
        onSelectCaller={noop}
        onClosePane={onClosePane}
        {...docProps}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close Impact Analysis panel' }))

    expect(onClosePane).toHaveBeenCalledTimes(1)
  })

  it('renders an impact analysis error', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'impact', status: 'error', message: 'boom' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders a ranked performance report when the complexity pane is loaded', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{
          kind: 'complexity',
          status: 'loaded',
          scores: [
            {
              node_id: 'app.py::Greeter.greet',
              cyclomatic_complexity: 4,
              call_chain_depth: 0,
              has_nested_loops: false,
            },
          ],
        }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByText('Performance Report')).toBeInTheDocument()
    expect(screen.getByText(/app\.py::Greeter\.greet/)).toBeInTheDocument()
    expect(screen.getByText(/complexity 4/)).toBeInTheDocument()
  })

  it('renders a complexity pane error', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={{ kind: 'complexity', status: 'error', message: 'boom' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('calls onToggleCollapsed when the collapse button is clicked', async () => {
    const onToggleCollapsed = vi.fn()
    const user = userEvent.setup()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        onToggleCollapsed={onToggleCollapsed}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Collapse details panel' }))

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it('shows only the expand toggle, and hides node details, when collapsed', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        collapsed={true}
      />,
    )

    expect(screen.getByRole('button', { name: 'Expand details panel' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'greet' })).not.toBeInTheDocument()
  })

  it('renders the resize handle with the current width reflected in its aria attributes', () => {
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        width={400}
      />,
    )

    const handle = screen.getByRole('separator', { name: 'Resize details panel' })
    expect(handle).toHaveAttribute('aria-valuenow', '400')
  })

  it('dragging the resize handle left grows the panel, reported via onResizeWidth', () => {
    const onResizeWidth = vi.fn()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        width={320}
        onResizeWidth={onResizeWidth}
      />,
    )

    const handle = screen.getByRole('separator', { name: 'Resize details panel' })
    fireEvent.pointerDown(handle, { clientX: 500, button: 0 })
    fireEvent.pointerMove(window, { clientX: 460 })

    // Dragging left (clientX 500 -> 460, a delta of -40) grows the
    // right-edge panel by the same 40px it shrunk the drag distance --
    // the opposite sign a left-edge handle would apply.
    expect(onResizeWidth).toHaveBeenCalledWith(360)
  })

  it('clamps a drag past the minimum width instead of shrinking further', () => {
    const onResizeWidth = vi.fn()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        width={280}
        onResizeWidth={onResizeWidth}
      />,
    )

    const handle = screen.getByRole('separator', { name: 'Resize details panel' })
    fireEvent.pointerDown(handle, { clientX: 500, button: 0 })
    // Dragging right by 200px would shrink the panel to 80px -- well under
    // the 260px floor.
    fireEvent.pointerMove(window, { clientX: 700 })

    expect(onResizeWidth).toHaveBeenCalledWith(260)
  })

  it('stops resizing once the pointer is released', () => {
    const onResizeWidth = vi.fn()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        width={320}
        onResizeWidth={onResizeWidth}
      />,
    )

    const handle = screen.getByRole('separator', { name: 'Resize details panel' })
    fireEvent.pointerDown(handle, { clientX: 500, button: 0 })
    fireEvent.pointerUp(window, { clientX: 500 })
    onResizeWidth.mockClear()
    fireEvent.pointerMove(window, { clientX: 400 })

    expect(onResizeWidth).not.toHaveBeenCalled()
  })

  it('resizes with the arrow keys, left growing and right shrinking', () => {
    const onResizeWidth = vi.fn()
    render(
      <DetailsPanel
        selectedNode={node}
        pane={null}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
        width={320}
        onResizeWidth={onResizeWidth}
      />,
    )

    const handle = screen.getByRole('separator', { name: 'Resize details panel' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResizeWidth).toHaveBeenLastCalledWith(336)

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResizeWidth).toHaveBeenLastCalledWith(304)
  })

  it('renders the data source pane when the pane kind is dataSource', () => {
    render(
      <DetailsPanel
        selectedNode={null}
        pane={{ kind: 'dataSource' }}
        onSelectCaller={noop}
        onClosePane={noop}
        {...docProps}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Add tables & models' })).toBeInTheDocument()
    expect(screen.getByLabelText(/dbt manifest.json path/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/database connection string/i)).toBeInTheDocument()
  })

  it('calls onClosePane from the data source pane header', async () => {
    const onClosePane = vi.fn()
    const user = userEvent.setup()
    render(
      <DetailsPanel
        selectedNode={null}
        pane={{ kind: 'dataSource' }}
        onSelectCaller={noop}
        onClosePane={onClosePane}
        {...docProps}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close Add tables & models panel' }))

    expect(onClosePane).toHaveBeenCalledTimes(1)
  })
})
