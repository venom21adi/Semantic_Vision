import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecommendationsControls, RecommendationsOutputPane } from './CodeHealthRecommendationsPane'

const baseControlsProps = {
  state: { status: 'idle' as const },
  provider: 'ollama' as const,
  onProviderChange: vi.fn(),
  ollamaModels: [] as string[],
  ollamaModelsLoading: false,
  ollamaModel: '',
  onOllamaModelChange: vi.fn(),
  onRefreshOllamaModels: vi.fn(),
  onGenerate: vi.fn(),
  dependencyDataAvailable: false,
}

describe('RecommendationsControls', () => {
  it('calls onGenerate when the Generate button is clicked', async () => {
    const onGenerate = vi.fn()
    const user = userEvent.setup()
    render(<RecommendationsControls {...baseControlsProps} onGenerate={onGenerate} />)

    await user.click(screen.getByRole('button', { name: 'Generate recommendations' }))

    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('disables the Generate button and shows a busy label while generating', () => {
    render(
      <RecommendationsControls
        {...baseControlsProps}
        state={{ status: 'generating', markdown: '' }}
      />,
    )

    const button = screen.getByRole('button', { name: 'Generating…' })
    expect(button).toBeDisabled()
  })

  it('shows Regenerate once a result has loaded', () => {
    render(
      <RecommendationsControls
        {...baseControlsProps}
        state={{ status: 'loaded', markdown: '## Top priorities' }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  })

  it('renders an error message', () => {
    render(
      <RecommendationsControls {...baseControlsProps} state={{ status: 'error', message: 'boom' }} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('lets the user pick a different provider', async () => {
    const onProviderChange = vi.fn()
    const user = userEvent.setup()
    render(<RecommendationsControls {...baseControlsProps} onProviderChange={onProviderChange} />)

    await user.selectOptions(screen.getByLabelText('AI provider'), 'anthropic')

    expect(onProviderChange).toHaveBeenCalledWith('anthropic')
  })

  it('notes when dependency scan results are not yet available', () => {
    render(<RecommendationsControls {...baseControlsProps} dependencyDataAvailable={false} />)

    expect(screen.getByText(/Run a dependency scan on the Dependencies tab first/)).toBeInTheDocument()
  })

  it('notes when dependency scan results will be included', () => {
    render(<RecommendationsControls {...baseControlsProps} dependencyDataAvailable />)

    expect(screen.getByText(/Includes this session's dependency scan results/)).toBeInTheDocument()
  })
})

describe('RecommendationsOutputPane', () => {
  it('shows a placeholder before anything has been generated', () => {
    render(<RecommendationsOutputPane state={{ status: 'idle' }} />)

    expect(screen.getByText(/Choose a provider and click Generate/)).toBeInTheDocument()
  })

  it('shows a spinner while generating before any content has streamed in yet', () => {
    render(<RecommendationsOutputPane state={{ status: 'generating', markdown: '' }} />)

    expect(screen.getByText('Generating…')).toBeInTheDocument()
  })

  it('renders streamed markdown while generating', () => {
    render(
      <RecommendationsOutputPane state={{ status: 'generating', markdown: '## Top priorities' }} />,
    )

    expect(screen.getByRole('heading', { name: 'Top priorities', level: 2 })).toBeInTheDocument()
  })

  it('renders the loaded markdown', () => {
    render(<RecommendationsOutputPane state={{ status: 'loaded', markdown: '## Quick wins' }} />)

    expect(screen.getByRole('heading', { name: 'Quick wins', level: 2 })).toBeInTheDocument()
  })

  it('renders nothing for an error state, leaving the message to the controls pane', () => {
    const { container } = render(
      <RecommendationsOutputPane state={{ status: 'error', message: 'boom' }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
