import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocPane } from './DocPane'

describe('DocPane', () => {
  it('shows a not-found message and lets the user pick a provider', async () => {
    const onProviderChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        pane={{ kind: 'doc', status: 'not-found' }}
        provider="ollama"
        onProviderChange={onProviderChange}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('AI provider'), 'anthropic')
    expect(onProviderChange).toHaveBeenCalledWith('anthropic')
  })

  it('calls onGenerate when the Generate button is clicked', async () => {
    const onGenerate = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        pane={{ kind: 'doc', status: 'not-found' }}
        provider="ollama"
        onProviderChange={vi.fn()}
        onGenerate={onGenerate}
        onSave={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('renders streamed markdown while generating, without a save button yet', () => {
    render(
      <DocPane
        pane={{ kind: 'doc', status: 'generating', markdown: '# greet' }}
        provider="ollama"
        onProviderChange={vi.fn()}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled()
  })

  it('shows a Save button once loaded, and Saved once saved', () => {
    const { rerender } = render(
      <DocPane
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
        provider="ollama"
        onProviderChange={vi.fn()}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()

    rerender(
      <DocPane
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: true }}
        provider="ollama"
        onProviderChange={vi.fn()}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
  })

  it('calls onSave when the Save button is clicked', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
        provider="ollama"
        onProviderChange={vi.fn()}
        onGenerate={vi.fn()}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('renders an error message', () => {
    render(
      <DocPane
        pane={{ kind: 'doc', status: 'error', message: 'boom' }}
        provider="ollama"
        onProviderChange={vi.fn()}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })
})
