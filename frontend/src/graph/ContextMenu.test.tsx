import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenu, type ContextMenuTarget } from './ContextMenu'

const target: ContextMenuTarget = { nodeId: 'app.py::Greeter.greet', label: 'greet', x: 10, y: 10 }

describe('ContextMenu', () => {
  it('renders Document, Impact Analysis, View Source, and Execution Flowchart actions', () => {
    render(
      <ContextMenu
        target={target}
        onClose={vi.fn()}
        onDocument={vi.fn()}
        onImpactAnalysis={vi.fn()}
        onViewSource={vi.fn()}
        onExecutionFlowchart={vi.fn()}
      />,
    )

    expect(screen.getByRole('menuitem', { name: 'Document' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Impact Analysis' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View Source' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Execution Flowchart' })).toBeInTheDocument()
  })

  it('invokes onExecutionFlowchart and closes on item click', async () => {
    const onExecutionFlowchart = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextMenu
        target={target}
        onClose={onClose}
        onDocument={vi.fn()}
        onImpactAnalysis={vi.fn()}
        onViewSource={vi.fn()}
        onExecutionFlowchart={onExecutionFlowchart}
      />,
    )

    await user.click(screen.getByRole('menuitem', { name: 'Execution Flowchart' }))

    expect(onExecutionFlowchart).toHaveBeenCalledWith('app.py::Greeter.greet')
    expect(onClose).toHaveBeenCalled()
  })

  it('invokes the matching callback and closes on item click', async () => {
    const onViewSource = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextMenu
        target={target}
        onClose={onClose}
        onDocument={vi.fn()}
        onImpactAnalysis={vi.fn()}
        onViewSource={onViewSource}
        onExecutionFlowchart={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('menuitem', { name: 'View Source' }))

    expect(onViewSource).toHaveBeenCalledWith('app.py::Greeter.greet')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when clicking outside the menu', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <div>
        <div data-testid="outside">outside</div>
        <ContextMenu
          target={target}
          onClose={onClose}
          onDocument={vi.fn()}
          onImpactAnalysis={vi.fn()}
          onViewSource={vi.fn()}
          onExecutionFlowchart={vi.fn()}
        />
      </div>,
    )

    await user.click(screen.getByTestId('outside'))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ContextMenu
        target={target}
        onClose={onClose}
        onDocument={vi.fn()}
        onImpactAnalysis={vi.fn()}
        onViewSource={vi.fn()}
        onExecutionFlowchart={vi.fn()}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })
})
