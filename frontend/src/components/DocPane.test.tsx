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
  onEditMarkdown: vi.fn(),
  docRoot: '/repo',
  fileName: 'greet',
  noticeDismissed: false,
  onDismissNotice: vi.fn(),
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

  it('shows the save-location notice with the current doc root when loaded and not dismissed', () => {
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
        docRoot="/some/project/root"
      />,
    )

    expect(screen.getByText(/some\/project\/root/)).toBeInTheDocument()
  })

  it('hides the save-location notice once dismissed', () => {
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
        noticeDismissed={true}
      />,
    )

    expect(screen.queryByText(/to change this/i)).not.toBeInTheDocument()
  })

  it('calls onDismissNotice when "Don\'t show again" is clicked', async () => {
    const onDismissNotice = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
        onDismissNotice={onDismissNotice}
      />,
    )

    await user.click(screen.getByRole('button', { name: /don't show again/i }))
    expect(onDismissNotice).toHaveBeenCalledTimes(1)
  })

  it('does not offer an inline "Change" control on the save-location notice', () => {
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: false }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    expect(screen.getByText(/save location field at the top/i)).toBeInTheDocument()
  })

  it('switches to a plain-text editor and calls onEditMarkdown as the user types', async () => {
    const onEditMarkdown = vi.fn()
    const user = userEvent.setup()
    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: true }}
        onEditMarkdown={onEditMarkdown}
      />,
    )

    expect(screen.queryByLabelText('Edit documentation')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    const textarea = screen.getByLabelText('Edit documentation')
    expect(textarea).toHaveValue('# greet')

    await user.type(textarea, '!')
    expect(onEditMarkdown).toHaveBeenCalledWith('# greet!')

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.queryByLabelText('Edit documentation')).not.toBeInTheDocument()
  })

  it('exports the current markdown as a downloadable .md file', async () => {
    const user = userEvent.setup()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    // jsdom doesn't implement these -- stub them for the duration of this test.
    Object.assign(URL, { createObjectURL, revokeObjectURL })

    render(
      <DocPane
        {...baseProps}
        pane={{ kind: 'doc', status: 'loaded', markdown: '# greet', saved: true }}
        fileName="app_py__Greeter_greet"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    clickSpy.mockRestore()
  })
})
