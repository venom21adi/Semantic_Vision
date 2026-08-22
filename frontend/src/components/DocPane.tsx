import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { DocProvider } from '../api/types'
import type { ActivePane } from './DetailsPanel'

type DocActivePane = Extract<ActivePane, { kind: 'doc' }>

interface DocPaneProps {
  pane: DocActivePane
  provider: DocProvider
  onProviderChange: (provider: DocProvider) => void
  ollamaModels: string[]
  ollamaModelsLoading: boolean
  ollamaModel: string
  onOllamaModelChange: (model: string) => void
  onRefreshOllamaModels: () => void
  onGenerate: () => void
  onSave: () => void
}

const PROVIDER_OPTIONS: { value: DocProvider; label: string }[] = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI (gpt-4o-mini)' },
  { value: 'anthropic', label: 'Anthropic (claude-haiku-4-5)' },
]

const selectStyle = {
  flex: 1,
  background: '#0f172a',
  color: '#f8fafc',
  border: '1px solid #1e293b',
  borderRadius: 6,
  padding: '4px 6px',
  fontSize: 12,
} as const

export function DocPane({
  pane,
  provider,
  onProviderChange,
  ollamaModels,
  ollamaModelsLoading,
  ollamaModel,
  onOllamaModelChange,
  onRefreshOllamaModels,
  onGenerate,
  onSave,
}: DocPaneProps) {
  const busy = pane.status === 'generating'
  const hasContent = pane.status === 'generating' || pane.status === 'loaded'
  const generateLabel = pane.status === 'loaded' ? 'Regenerate' : 'Generate'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select
          aria-label="AI provider"
          value={provider}
          disabled={busy}
          onChange={(event) => onProviderChange(event.target.value as DocProvider)}
          style={selectStyle}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          style={{
            background: '#1d4ed8',
            color: '#f8fafc',
            border: 'none',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Generating…' : generateLabel}
        </button>
      </div>

      {provider === 'ollama' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <select
            aria-label="Ollama model"
            value={ollamaModel}
            disabled={busy || ollamaModels.length === 0}
            onChange={(event) => onOllamaModelChange(event.target.value)}
            style={selectStyle}
          >
            {ollamaModels.length === 0 && <option value="">No local models found</option>}
            {ollamaModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Refresh Ollama models"
            onClick={onRefreshOllamaModels}
            disabled={ollamaModelsLoading}
            style={{
              background: 'transparent',
              border: '1px solid #1e293b',
              color: '#94a3b8',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
              cursor: ollamaModelsLoading ? 'default' : 'pointer',
            }}
          >
            {ollamaModelsLoading ? '…' : '⟳'}
          </button>
        </div>
      )}
      {provider === 'ollama' && ollamaModels.length === 0 && !ollamaModelsLoading && (
        <p style={{ color: '#94a3b8', marginTop: -4, marginBottom: 12, fontSize: 12 }}>
          No local Ollama models found. Run <code>ollama serve</code> and{' '}
          <code>ollama pull &lt;model&gt;</code>, then refresh.
        </p>
      )}

      {pane.status === 'not-found' && (
        <p style={{ color: '#94a3b8' }}>
          No saved documentation yet. Choose a provider and generate one.
        </p>
      )}

      {pane.status === 'error' && (
        <p role="alert" style={{ color: '#fca5a5' }}>
          {pane.message}
        </p>
      )}

      {hasContent && (
        <>
          <div
            className="doc-markdown"
            style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 6,
              padding: 10,
              fontSize: 12,
              overflowX: 'auto',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {pane.markdown}
            </ReactMarkdown>
          </div>
          {pane.status === 'loaded' && (
            <button
              type="button"
              onClick={onSave}
              disabled={pane.saved}
              style={{
                marginTop: 8,
                background: pane.saved ? '#1e293b' : '#15803d',
                color: '#f8fafc',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: pane.saved ? 'default' : 'pointer',
              }}
            >
              {pane.saved ? 'Saved' : 'Save'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
