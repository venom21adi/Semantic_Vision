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
  onGenerate: () => void
  onSave: () => void
}

const PROVIDER_OPTIONS: { value: DocProvider; label: string }[] = [
  { value: 'ollama', label: 'Ollama (llama3)' },
  { value: 'openai', label: 'OpenAI (gpt-4o-mini)' },
  { value: 'anthropic', label: 'Anthropic (claude-haiku-4-5)' },
]

export function DocPane({ pane, provider, onProviderChange, onGenerate, onSave }: DocPaneProps) {
  const busy = pane.status === 'generating'
  const hasContent = pane.status === 'generating' || pane.status === 'loaded'
  const generateLabel = pane.status === 'loaded' ? 'Regenerate' : 'Generate'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select
          aria-label="AI provider"
          value={provider}
          disabled={busy}
          onChange={(event) => onProviderChange(event.target.value as DocProvider)}
          style={{
            flex: 1,
            background: '#0f172a',
            color: '#f8fafc',
            border: '1px solid #1e293b',
            borderRadius: 6,
            padding: '4px 6px',
            fontSize: 12,
          }}
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
