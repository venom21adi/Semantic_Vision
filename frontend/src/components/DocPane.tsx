import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { DEMO_MODE } from '../api/client'
import type { DocProvider } from '../api/types'
import { colors, font, radius, spacing } from '../theme'
import type { ActivePane } from './DetailsPanel'
import { RecordingLightbox } from './RecordingLightbox'

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
  borderRadius: radius.sm,
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
  const [showRecording, setShowRecording] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

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
      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm }}>
        <select
          aria-label="AI provider"
          title="Which provider generates the documentation"
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
          title="Generate Markdown documentation from this function's real source, callers, and callees"
          style={{
            background: colors.accentStrong,
            color: colors.textPrimary,
            border: 'none',
            borderRadius: radius.sm,
            padding: '4px 10px',
            fontSize: 12,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Generating…' : generateLabel}
        </button>
      </div>

      {provider === 'ollama' && (
        <div
          style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md }}
        >
          <select
            aria-label="Ollama model"
            title="Which locally installed Ollama model to use"
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
            title="Re-check which models you have pulled locally"
            onClick={onRefreshOllamaModels}
            disabled={ollamaModelsLoading}
            className="sv-interactive"
            style={{
              background: 'transparent',
              border: `1px solid ${colors.bgPanel}`,
              color: colors.textMuted,
              borderRadius: radius.sm,
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
        <p style={{ color: colors.textMuted, marginTop: -4, marginBottom: spacing.md, fontSize: 12 }}>
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
        <>
          <p role="alert" style={{ color: colors.danger }}>
            {pane.message}
          </p>
          {DEMO_MODE && pane.message.includes('precomputed for a handful') && (
            <div style={{ marginTop: spacing.sm }}>
              <button
                type="button"
                onClick={() => setShowRecording((prev) => !prev)}
                className="sv-interactive"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: colors.accent,
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                {showRecording ? '▾ Hide recording' : '▸ Watch AI docs generate on a real repo'}
              </button>
              {showRecording && (
                <img
                  src={`${import.meta.env.BASE_URL}demo/media/ai-doc-generation.gif`}
                  alt="AI documentation streaming in for a function in the real app"
                  onClick={() => setLightboxOpen(true)}
                  style={{
                    marginTop: spacing.xs,
                    width: '100%',
                    borderRadius: radius.sm,
                    cursor: 'zoom-in',
                  }}
                />
              )}
              {lightboxOpen && (
                <RecordingLightbox
                  src={`${import.meta.env.BASE_URL}demo/media/ai-doc-generation.gif`}
                  alt="AI documentation streaming in for a function in the real app"
                  onClose={() => setLightboxOpen(false)}
                />
              )}
            </div>
          )}
        </>
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
                borderRadius: radius.sm,
                padding: 10,
                fontSize: 12,
                fontFamily: font.mono,
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
                borderRadius: radius.sm,
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
            <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm }}>
              <button
                type="button"
                onClick={onSave}
                disabled={pane.saved}
                className="sv-interactive"
                title={pane.saved ? 'Already saved' : `Write this documentation to ${docRoot}`}
                style={{
                  background: pane.saved ? colors.bgPanel : colors.successBg,
                  color: colors.textPrimary,
                  border: 'none',
                  borderRadius: radius.sm,
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
                title={isEditing ? 'Preview the rendered Markdown' : 'Edit the Markdown by hand before saving'}
                style={secondaryButtonStyle}
              >
                {isEditing ? 'Preview' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="sv-interactive"
                title="Download this documentation as a .md file"
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
  borderRadius: radius.sm,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const

function SaveLocationNotice({ docRoot, onDismiss }: { docRoot: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        marginTop: spacing.sm,
        padding: `6px ${spacing.sm}px`,
        background: colors.bgPage,
        border: `1px solid ${colors.bgPanel}`,
        borderRadius: radius.sm,
        fontSize: 11,
        color: colors.textMuted,
      }}
    >
      <p style={{ margin: `0 0 ${spacing.xs}px` }}>
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
