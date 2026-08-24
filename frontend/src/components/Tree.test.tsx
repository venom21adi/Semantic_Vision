import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode } from '../api/types'
import { Tree } from './Tree'
import { buildTree, collectMatchIds, collectVisiblePath, type TreeNode } from '../tree/buildTree'

function node(id: string, kind: GraphNode['kind'], label = id): GraphNode {
  return { id, kind, label, file: 'app.py', line_start: 1, line_end: 1 }
}

const fileNode = node('app.py', 'file', 'app.py')
const classNode = node('app.py::Greeter', 'class', 'Greeter')
const methodNode = node('app.py::Greeter.greet', 'function', 'greet')

const roots: TreeNode[] = [
  {
    node: fileNode,
    children: [{ node: classNode, children: [{ node: methodNode, children: [] }] }],
  },
]

describe('Tree', () => {
  it('renders root and expanded child labels', () => {
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.getByText('app.py')).toBeInTheDocument()
    expect(screen.getByText('Greeter')).toBeInTheDocument()
  })

  it('calls onSelectNode with the clicked item id', async () => {
    const onSelectNode = vi.fn()
    const user = userEvent.setup()
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    await user.click(screen.getByText('Greeter'))

    expect(onSelectNode).toHaveBeenCalledWith('app.py::Greeter')
  })

  it('marks the selected item via aria-selected', () => {
    render(
      <Tree
        roots={roots}
        selectedNodeId="app.py::Greeter"
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.getByText('Greeter').closest('[role="treeitem"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('collapses a directory with more than 5 children by default, expandable via its toggle', async () => {
    const manyFiles: TreeNode[] = Array.from({ length: 6 }, (_, i) => ({
      node: node(`pkg/f${i}.py`, 'file', `f${i}.py`),
      children: [],
    }))
    const dirRoots: TreeNode[] = [{ node: node('pkg', 'directory'), children: manyFiles }]
    const user = userEvent.setup()

    render(
      <Tree
        roots={dirRoots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.queryByText('f0.py')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand pkg' }))

    expect(screen.getByText('f0.py')).toBeInTheDocument()
  })

  it('hides items outside visibleIds when a filter is active', () => {
    const filterRoots = buildTree(
      [fileNode, classNode, methodNode, node('app.py::other', 'function', 'other')],
      [
        { source: 'app.py', target: 'app.py::Greeter', kind: 'defines', external: false, ambiguous: false },
        {
          source: 'app.py::Greeter',
          target: 'app.py::Greeter.greet',
          kind: 'defines',
          external: false,
          ambiguous: false,
        },
        { source: 'app.py', target: 'app.py::other', kind: 'defines', external: false, ambiguous: false },
      ],
    )
    const matchIds = collectMatchIds(filterRoots, 'greet')
    const visibleIds = collectVisiblePath(filterRoots, matchIds)

    render(
      <Tree
        roots={filterRoots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={visibleIds}
        matchIds={matchIds}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.getByText('greet')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
  })

  it('marks matching items with data-match', () => {
    const matchIds = new Set(['app.py::Greeter.greet'])

    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={matchIds}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.getByText('greet').closest('[role="treeitem"]')).toHaveAttribute('data-match', 'true')
    expect(screen.getByText('Greeter').closest('[role="treeitem"]')).not.toHaveAttribute('data-match')
  })

  it('renders a checkbox only for directory/file rows, not class/function rows', () => {
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Show app.py on canvas')).toBeInTheDocument()
    expect(screen.queryByLabelText('Show Greeter on canvas')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Show greet on canvas')).not.toBeInTheDocument()
  })

  it('reflects selectedRootIds via the checkbox checked state', () => {
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set(['app.py'])}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Show app.py on canvas')).toBeChecked()
  })

  it('clicking the checkbox toggles selection without selecting the node', async () => {
    const onSelectNode = vi.fn()
    const onToggleRootSelection = vi.fn()
    const user = userEvent.setup()
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={onToggleRootSelection}
      />,
    )

    await user.click(screen.getByLabelText('Show app.py on canvas'))

    expect(onToggleRootSelection).toHaveBeenCalledWith('app.py')
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it('clicking the row label selects the node without toggling its checkbox', async () => {
    const onSelectNode = vi.fn()
    const onToggleRootSelection = vi.fn()
    const user = userEvent.setup()
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={onToggleRootSelection}
      />,
    )

    await user.click(screen.getByText('app.py'))

    expect(onSelectNode).toHaveBeenCalledWith('app.py')
    expect(onToggleRootSelection).not.toHaveBeenCalled()
  })

  it('toggles selection via keyboard (Space) without also selecting the row', async () => {
    const onSelectNode = vi.fn()
    const onToggleRootSelection = vi.fn()
    const user = userEvent.setup()
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={new Set()}
        onToggleRootSelection={onToggleRootSelection}
      />,
    )

    screen.getByLabelText('Show app.py on canvas').focus()
    await user.keyboard(' ')

    expect(onToggleRootSelection).toHaveBeenCalledWith('app.py')
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it('renders no checkboxes when selectedRootIds is null', () => {
    render(
      <Tree
        roots={roots}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        visibleIds={null}
        matchIds={new Set()}
        selectedRootIds={null}
        onToggleRootSelection={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('Show app.py on canvas')).not.toBeInTheDocument()
  })
})
