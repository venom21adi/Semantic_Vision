import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { DocProvider } from '../api/types'
import { colors, radius, spacing } from '../theme'
import type { RecommendationsState } from './codeHealthTypes'

interface RecommendationsControlsProps {
  state: RecommendationsState
  provider: DocProvider
  onProviderChange: (provider: DocProvider) => void
  ollamaModels: string[]
  ollamaModelsLoading: boolean
  ollamaModel: string
  onOllamaModelChange: (model: string) => void
  onRefreshOllamaModels: () => void
  onGenerate: () => void
  /** Whether this session already has a completed, available dependency
   * scan to fold into the summary -- purely informational copy, since the
   * actual decision (never fetch dependency data here) lives server-side
   * and in `App.tsx`'s `handleGenerateRecommendations`. */
  dependencyDataAvailable: boolean
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

/** The Recommendations tab's sidebar-column content -- intro copy,
 * provider/model pick, and the Generate button, mirroring `DocPane`'s own
 * controls. Deliberately doesn't render the streamed markdown itself
 * (see `RecommendationsOutputPane`, rendered in `CodeHealthDetail`'s
 * canvas column instead): the sidebar's list-width column is far
 * narrower than the shared detail area, and prose reads better there
 * than force-fit into the same column every ranked list uses. */
export function RecommendationsControls({
  state,
  provider,
  onProviderChange,
  ollamaModels,
  ollamaModelsLoading,
  ollamaModel,
  onOllamaModelChange,
  onRefreshOllamaModels,
  onGenerate,
  dependencyDataAvailable,
}: RecommendationsControlsProps) {
  const busy = state.status === 'generating'
  const generateLabel = state.status === 'loaded' ? 'Regenerate' : 'Generate recommendations'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Asks an AI provider to prioritize across complexity, hotspots, coverage, and duplicate
        findings for this repo.{' '}
        {dependencyDataAvailable
          ? "Includes this session's dependency scan results."
          : "Run a dependency scan on the Dependencies tab first to include it -- this won't trigger one automatically."}
      </p>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm }}>
        <select
          aria-label="AI provider"
          title="Which provider generates the recommendations"
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
      </div>

      {provider === 'ollama' && (
        <div
          style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}
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

      <button
        type="button"
        onClick={onGenerate}
        disabled={busy}
        className="sv-interactive"
        title="Generate prioritized recommendations from this repo's real Code Health data"
        style={{
          background: colors.accentStrong,
          color: colors.textPrimary,
          border: 'none',
          borderRadius: radius.sm,
          padding: '6px 12px',
          fontSize: 12,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Generating…' : generateLabel}
      </button>

      {state.status === 'error' && (
        <p role="alert" style={{ color: colors.danger, marginTop: spacing.sm }}>
          {state.message}
        </p>
      )}
    </div>
  )
}

/** The Recommendations tab's canvas-column content -- rendered in
 * `CodeHealthDetail` in the exact position `MiniCallGraph`/
 * `PackageImportersGraph` occupy for every other tab. */
export function RecommendationsOutputPane({ state }: { state: RecommendationsState }) {
  if (state.status === 'idle') {
    return (
      <p style={{ color: colors.textMuted, fontSize: 12, padding: spacing.lg, margin: 0 }}>
        Choose a provider and click Generate to get a prioritized punch list.
      </p>
    )
  }

  if (state.status === 'error') {
    // The error itself is already shown next to the Generate button in
    // `RecommendationsControls` -- this panel just avoids rendering a
    // stale/empty markdown block underneath it.
    return null
  }

  if (state.status === 'generating' && state.markdown === '') {
    // `stream_documentation` (see ai/providers.py) eagerly pulls the
    // model's *first* chunk before the backend sends any response bytes
    // at all -- for a real provider this can be several seconds to over a
    // minute (model load + prompt processing) before anything streams,
    // during which an empty `.doc-markdown` box would otherwise render as
    // a plain black rectangle with zero indication anything is happening.
    // Every other Code Health tab's own "still fetching" state uses a
    // spinner (`CodeHealthSidebar.tsx`'s `LoadingNotice`); this reuses the
    // same `.spinner` CSS class rather than that component's skeleton
    // *rows*, since this canvas renders prose, not a ranked list.
    return (
      <p
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          padding: spacing.lg,
          margin: 0,
          color: colors.textMuted,
          fontSize: 12,
        }}
      >
        <span className="spinner" aria-hidden="true" />
        Generating…
      </p>
    )
  }

  return (
    <div
      className="doc-markdown"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        margin: spacing.md,
        background: colors.bgPage,
        border: `1px solid ${colors.bgPanel}`,
        borderRadius: radius.sm,
        padding: 10,
        fontSize: 12,
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {state.markdown}
      </ReactMarkdown>
    </div>
  )
}
