import { useState } from 'react'
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
  docRoot: string
  onChangeDocRoot: (newDocRoot: string) => void
  noticeDismissed: boolean
  onDismissNotice: () => void
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
  docRoot,
  onChangeDocRoot,
  noticeDismissed,
  onDismissNotice,
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
          {pane.status === 'loaded' && !noticeDismissed && (
            <SaveLocationNotice
              docRoot={docRoot}
              onChangeDocRoot={onChangeDocRoot}
              onDismiss={onDismissNotice}
            />
          )}
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

function SaveLocationNotice({
  docRoot,
  onChangeDocRoot,
  onDismiss,
}: {
  docRoot: string
  onChangeDocRoot: (newDocRoot: string) => void
  onDismiss: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(docRoot)

  function submit() {
    const trimmed = value.trim()
    if (trimmed && trimmed !== docRoot) onChangeDocRoot(trimmed)
    setEditing(false)
  }

  return (
    <div
      role="status"
      style={{
        marginTop: 8,
        padding: '6px 8px',
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: 6,
        fontSize: 11,
        color: '#94a3b8',
      }}
    >
      {!editing && (
        <>
          <p style={{ margin: '0 0 4px' }}>
            Documentation is saved to <code>{docRoot}</code>.
          </p>
          <button
            type="button"
            onClick={() => {
              setValue(docRoot)
              setEditing(true)
            }}
            style={linkButtonStyle}
          >
            Change
          </button>{' '}
          <button type="button" onClick={onDismiss} style={linkButtonStyle}>
            Don't show again
          </button>
        </>
      )}
      {editing && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="New save location"
            style={{
              flex: 1,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #334155',
              background: '#0b1220',
              color: '#f8fafc',
              fontSize: 11,
            }}
          />
          <button type="button" onClick={submit} style={linkButtonStyle}>
            Update
          </button>
          <button type="button" onClick={() => setEditing(false)} style={linkButtonStyle}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

const linkButtonStyle = {
  background: 'transparent',
  border: 'none',
  color: '#64748b',
  fontSize: 11,
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
} as const
