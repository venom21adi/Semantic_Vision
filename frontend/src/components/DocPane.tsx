import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { DocProvider } from '../api/types'
import { colors } from '../theme'
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
  onEditMarkdown: (markdown: string) => void
  docRoot: string
  fileName: string
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
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
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
  onEditMarkdown,
  docRoot,
  fileName,
  noticeDismissed,
  onDismissNotice,
}: DocPaneProps) {
  const busy = pane.status === 'generating'
  const hasContent = pane.status === 'generating' || pane.status === 'loaded'
  const generateLabel = pane.status === 'loaded' ? 'Regenerate' : 'Generate'

  const [isEditing, setIsEditing] = useState(false)

  // Mirrors RepoLoader's "adjust state when a prop changes" pattern: a
  // fresh generation replaces whatever was being edited, so drop back to
  // the streaming preview during render rather than leaving a stale
  // textarea open over content that's about to change out from under it.
  const [lastPaneStatus, setLastPaneStatus] = useState(pane.status)
  if (pane.status !== lastPaneStatus) {
    setLastPaneStatus(pane.status)
    if (pane.status === 'generating') setIsEditing(false)
  }

  function handleExport() {
    if (pane.status !== 'loaded') return
    const blob = new Blob([pane.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileName}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

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
          className="sv-interactive"
          style={{
            background: colors.accentStrong,
            color: colors.textPrimary,
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
            className="sv-interactive"
            style={{
              background: 'transparent',
              border: `1px solid ${colors.bgPanel}`,
              color: colors.textMuted,
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
        <p style={{ color: colors.textMuted, marginTop: -4, marginBottom: 12, fontSize: 12 }}>
          No local Ollama models found. Run <code>ollama serve</code> and{' '}
          <code>ollama pull &lt;model&gt;</code>, then refresh.
        </p>
      )}

      {pane.status === 'not-found' && (
        <p style={{ color: colors.textMuted }}>
          No saved documentation yet. Choose a provider and generate one.
        </p>
      )}

      {pane.status === 'error' && (
        <p role="alert" style={{ color: colors.danger }}>
          {pane.message}
        </p>
      )}

      {hasContent && (
        <>
          {isEditing && pane.status === 'loaded' ? (
            <textarea
              aria-label="Edit documentation"
              value={pane.markdown}
              onChange={(event) => onEditMarkdown(event.target.value)}
              style={{
                width: '100%',
                minHeight: 220,
                boxSizing: 'border-box',
                background: colors.bgPage,
                border: `1px solid ${colors.bgPanel}`,
                borderRadius: 6,
                padding: 10,
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: colors.textPrimary,
                resize: 'vertical',
              }}
            />
          ) : (
            <div
              className="doc-markdown"
              style={{
                background: colors.bgPage,
                border: `1px solid ${colors.bgPanel}`,
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
          )}
          {pane.status === 'loaded' && !noticeDismissed && (
            <SaveLocationNotice docRoot={docRoot} onDismiss={onDismissNotice} />
          )}
          {pane.status === 'loaded' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={onSave}
                disabled={pane.saved}
                className="sv-interactive"
                style={{
                  background: pane.saved ? colors.bgPanel : colors.successBg,
                  color: colors.textPrimary,
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 12,
                  cursor: pane.saved ? 'default' : 'pointer',
                }}
              >
                {pane.saved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className="sv-interactive"
                style={secondaryButtonStyle}
              >
                {isEditing ? 'Preview' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="sv-interactive"
                style={secondaryButtonStyle}
              >
                Export
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const secondaryButtonStyle = {
  background: 'transparent',
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const

function SaveLocationNotice({ docRoot, onDismiss }: { docRoot: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        marginTop: 8,
        padding: '6px 8px',
        background: colors.bgPage,
        border: `1px solid ${colors.bgPanel}`,
        borderRadius: 6,
        fontSize: 11,
        color: colors.textMuted,
      }}
    >
      <p style={{ margin: '0 0 4px' }}>
        Documentation is saved to <code>{docRoot}</code>. Change this in the Save location field
        at the top of the page.
      </p>
      <button type="button" onClick={onDismiss} className="sv-interactive" style={linkButtonStyle}>
        Don't show again
      </button>
    </div>
  )
}

const linkButtonStyle = {
  background: 'transparent',
  border: 'none',
  color: colors.textDim,
  fontSize: 11,
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
} as const
