import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocPane } from './DocPane'

const baseProps = {
  provider: 'ollama' as const,
  onProviderChange: vi.fn(),
  ollamaModels: [] as string[],
  ollamaModelsLoading: false,
  ollamaModel: '',
  onOllamaModelChange: vi.fn(),
  onRefreshOllamaModels: vi.fn(),
  onGenerate: vi.fn(),
  onSave: vi.fn(),
}

describe('DocPane', () => {
  it('shows a not-found message and lets the user pick a provider', async () => {
    const onProviderChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane {...baseProps} pane={{ kind: 'doc', status: 'not-found' }} onProviderChange={onProviderChange} />,
    )

    expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('AI provider'), 'anthropic')
    expect(onProviderChange).toHaveBeenCalledWith('anthropic')
  })

  it('calls onGenerate when the Generate button is clicked', async () => {
    const onGenerate = vi.fn()
    const user = userEvent.setup()
    render(<DocPane {...baseProps} pane={{ kind: 'doc', status: 'not-found' }} onGenerate={onGenerate} />)

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('renders streamed markdown while generating, without a save button yet', () => {
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'generating', markdown: '# greet' }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled()
  })

  it('shows a Save button once loaded, and Saved once saved', () => {
    const { rerender } = render(
      <DocPane {...baseProps} pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }} />,
    )

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()

    rerender(
      <DocPane {...baseProps} pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: true }} />,
    )

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
  })

  it('calls onSave when the Save button is clicked', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('renders an error message', () => {
    render(<DocPane {...baseProps} pane={{ kind: 'doc', status: 'error', message: 'boom' }} />)

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('shows an Ollama model select with the available local models when provider is ollama', async () => {
    const onOllamaModelChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'not-found' }}
        ollamaModels={['llama3.2:3b', 'qwen2.5-coder:3b']}
        ollamaModel="llama3.2:3b"
        onOllamaModelChange={onOllamaModelChange}
      />,
    )

    const modelSelect = screen.getByLabelText('Ollama model')
    expect(modelSelect).toBeInTheDocument()
    await user.selectOptions(modelSelect, 'qwen2.5-coder:3b')
    expect(onOllamaModelChange).toHaveBeenCalledWith('qwen2.5-coder:3b')
  })

  it('hides the Ollama model select for other providers', () => {
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'not-found' }}
        provider="openai"
        ollamaModels={['llama3.2:3b']}
      />,
    )

    expect(screen.queryByLabelText('Ollama model')).not.toBeInTheDocument()
  })

  it('shows a hint and lets the user refresh when no local Ollama models are found', async () => {
    const onRefreshOllamaModels = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'not-found' }}
        ollamaModels={[]}
        onRefreshOllamaModels={onRefreshOllamaModels}
      />,
    )

    expect(screen.getByText(/no local ollama models found/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh Ollama models' }))
    expect(onRefreshOllamaModels).toHaveBeenCalledTimes(1)
  })
})
