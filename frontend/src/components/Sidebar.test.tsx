import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphEdge, GraphNode } from '../api/types'
import { Sidebar } from './Sidebar'

const nodes: GraphNode[] = [
  { id: 'app.py', kind: 'file', label: 'app.py', file: 'app.py', line_start: 1, line_end: 8 },
  {
    id: 'app.py::Greeter',
    kind: 'class',
    label: 'Greeter',
    file: 'app.py',
    line_start: 5,
    line_end: 8,
  },
  {
    id: 'app.py::Greeter.greet',
    kind: 'function',
    label: 'greet',
    file: 'app.py',
    line_start: 6,
    line_end: 8,
  },
  {
    id: 'app.py::unrelated',
    kind: 'function',
    label: 'unrelated',
    file: 'app.py',
    line_start: 10,
    line_end: 11,
  },
]

const edges: GraphEdge[] = [
  { source: 'app.py', target: 'app.py::Greeter', kind: 'defines', external: false, ambiguous: false },
  {
    source: 'app.py::Greeter',
    target: 'app.py::Greeter.greet',
    kind: 'defines',
    external: false,
    ambiguous: false,
  },
  { source: 'app.py', target: 'app.py::unrelated', kind: 'defines', external: false, ambiguous: false },
]

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props: React.ComponentProps<typeof Sidebar> = {
    nodes,
    edges,
    selectedNodeId: null,
    onSelectNode: vi.fn(),
    view: 'codebase',
    onViewChange: vi.fn(),
    complexityActive: false,
    onToggleComplexity: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  }
  return { ...render(<Sidebar {...props} />), props }
}

describe('Sidebar', () => {
  it('renders the full tree with no match count when the filter is empty', () => {
    renderSidebar()

    expect(screen.getByText('app.py')).toBeInTheDocument()
    expect(screen.getByText('Greeter')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('filters in real time and shows a match count', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.type(screen.getByLabelText('Filter tree'), 'greet')

    // "greet" matches both the "greet" method and its "Greeter" class.
    expect(screen.getByRole('status')).toHaveTextContent('2 matches')
    expect(screen.getByText('greet')).toBeInTheDocument()
    expect(screen.getByText('Greeter')).toBeInTheDocument()
    expect(screen.queryByText('unrelated')).not.toBeInTheDocument()
  })

  it('clears the filter on Escape', async () => {
    const user = userEvent.setup()
    renderSidebar()

    const input = screen.getByLabelText('Filter tree')
    await user.type(input, 'greet')
    expect(input).toHaveValue('greet')

    await user.keyboard('{Escape}')

    expect(input).toHaveValue('')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears the filter via the clear button', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.type(screen.getByLabelText('Filter tree'), 'greet')
    await user.click(screen.getByRole('button', { name: 'Clear filter' }))

    expect(screen.getByLabelText('Filter tree')).toHaveValue('')
  })

  it('calls onViewChange when the Codebase/File toggle is used', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'file' }))

    expect(props.onViewChange).toHaveBeenCalledWith('file')
  })

  it('reflects the active view via aria-pressed', () => {
    renderSidebar({ view: 'file' })

    expect(screen.getByRole('button', { name: 'file' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'codebase' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onToggleComplexity when the complexity toggle is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Show complexity' }))

    expect(props.onToggleComplexity).toHaveBeenCalledTimes(1)
  })

  it('reflects the active complexity state via aria-pressed and label', () => {
    renderSidebar({ complexityActive: true })

    const button = screen.getByRole('button', { name: 'Hide complexity' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onToggleCollapsed when the collapse button is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it('shows only the expand toggle, and hides the tree, when collapsed', () => {
    renderSidebar({ collapsed: true })

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(screen.queryByText('app.py')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filter tree')).not.toBeInTheDocument()
  })
})
