import { useState, type FormEvent } from 'react'
import type { ParseErrorInfo } from '../api/types'
import { colors, radius, spacing } from '../theme'

export interface RepoLoadStats {
  path: string
  nodeCount: number
  edgeCount: number
  parseErrors: ParseErrorInfo[]
}

interface RepoLoaderProps {
  onLoad: (path: string, docRoot: string, language: string) => void
  loading: boolean
  error: string | null
  initialPath?: string
  initialDocRoot?: string
  initialLanguage?: string
  /** The save location actually in effect after the last successful
   * load -- may differ from what was typed (e.g. auto-detected), so the
   * field reflects reality rather than staying stuck on stale input. */
  resolvedDocRoot?: string | null
  stats: RepoLoadStats | null
  /** Whether a repository is currently loaded -- this is the single place
   * the save location can be edited, so once a repo is loaded, committing
   * a change here applies it live instead of only taking effect on the
   * next Load. */
  hasLoadedRepo?: boolean
  onChangeDocRoot?: (newDocRoot: string) => void
  /** Skips the outer card border/background -- for a caller that already
   * provides its own surface (e.g. a popover), so the chrome isn't drawn
   * twice. */
  bare?: boolean
  /** Stacks the path/language/Load row vertically instead of side-by-side
   * -- for a narrow container (a popover) where the row layout used in the
   * full-width empty-state card wouldn't fit. */
  stacked?: boolean
}

export function RepoLoader({
  onLoad,
  loading,
  error,
  initialPath,
  initialDocRoot,
  initialLanguage,
  resolvedDocRoot,
  stats,
  hasLoadedRepo = false,
  onChangeDocRoot,
  bare = false,
  stacked = false,
}: RepoLoaderProps) {
  const [path, setPath] = useState(initialPath ?? '')
  const [docRoot, setDocRoot] = useState(initialDocRoot ?? '')
  const [language, setLanguage] = useState(initialLanguage ?? 'python')

  // Adjusts `docRoot` when `resolvedDocRoot` changes (a fresh load
  // resolved to a new save location -- possibly auto-detected, so it
  // wasn't necessarily typed anywhere), without the extra render an
  // effect would cost: tracking the last-seen prop value in state lets
  // this branch run during render itself, per React's guidance for
  // "adjusting state when a prop changes".
  const [lastResolvedDocRoot, setLastResolvedDocRoot] = useState(resolvedDocRoot)
  if (resolvedDocRoot !== lastResolvedDocRoot) {
    setLastResolvedDocRoot(resolvedDocRoot)
    if (resolvedDocRoot) setDocRoot(resolvedDocRoot)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = path.trim()
    if (trimmed) onLoad(trimmed, docRoot.trim(), language)
  }

  // Committing this field is the single place the save location changes:
  // before a repo is loaded, it just seeds the next Load call; once one
  // is loaded, blurring (or pressing Enter) applies the change live via
  // `onChangeDocRoot` instead of waiting for a reload.
  function commitDocRoot() {
    if (!hasLoadedRepo || !onChangeDocRoot) return
    const trimmed = docRoot.trim()
    if (trimmed && trimmed !== resolvedDocRoot) {
      onChangeDocRoot(trimmed)
    } else if (resolvedDocRoot) {
      // Blank, whitespace-only, or unchanged: nothing to apply -- snap the
      // field back to what's actually in effect rather than leaving it
      // (e.g. blank) permanently desynced from the real save location.
      setDocRoot(resolvedDocRoot)
    }
  }

  const fieldLabelStyle = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: colors.textDim,
    marginBottom: 3,
  }

  return (
    <div
      style={
        bare
          ? undefined
          : {
              padding: spacing.sm,
              borderRadius: radius.md,
              border: `1px solid ${colors.border}`,
              background: colors.bgPanel,
            }
      }
    >
      <form onSubmit={handleSubmit}>
        <div
          style={{
            display: 'flex',
            flexDirection: stacked ? 'column' : 'row',
            gap: spacing.sm,
            alignItems: stacked ? 'stretch' : 'flex-end',
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <label htmlFor="repo-path-input" style={fieldLabelStyle}>
              Repository path
            </label>
            <input
              id="repo-path-input"
              type="text"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="e.g. C:/Users/you/projects/my-repo"
              aria-label="Repository path"
              title="Absolute path to a local Python or JavaScript/TypeScript repository"
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: radius.sm,
                border: `1px solid ${colors.border}`,
                background: colors.bgPage,
                color: colors.textPrimary,
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            <span style={{ marginTop: 3, fontSize: 11, color: colors.textDim }}>
              Running via Docker Compose? Paste the same path you set as{' '}
              <code>REPO_PATH</code> in <code>.env</code> (or a subfolder of it) — it's mapped
              into the container automatically.
            </span>
          </div>
          <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: stacked ? 1 : undefined }}>
              <label htmlFor="repo-language-select" style={fieldLabelStyle}>
                Language
              </label>
              <select
                id="repo-language-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                aria-label="Language"
                title="Which language's parser to use for this repository"
                style={{
                  width: stacked ? '100%' : undefined,
                  padding: '6px 10px',
                  borderRadius: radius.sm,
                  border: `1px solid ${colors.border}`,
                  background: colors.bgPage,
                  color: colors.textPrimary,
                  fontSize: 13,
                }}
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript / TypeScript</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={loading || path.trim().length === 0}
              className="sv-interactive"
              title="Parse the repository and build its graph"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: radius.sm,
                border: 'none',
                background: loading ? colors.disabled : colors.accent,
                color: colors.textPrimary,
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? 'default' : 'pointer',
                alignSelf: 'flex-end',
              }}
            >
              {loading && <span className="spinner" aria-hidden="true" />}
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
        </div>
        {error && (
          <span role="alert" style={{ display: 'block', marginTop: 6, color: colors.danger, fontSize: 12 }}>
            {error}
          </span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: spacing.sm }}>
          <label
            htmlFor="doc-root-input"
            title="Where dragged layout, saved docs, and analysis state are written -- defaults to the repo's .git root"
            style={fieldLabelStyle}
          >
            Save location{' '}
            <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 'normal' }}>
              (optional — defaults to the repo's own folder)
            </span>
          </label>
          <input
            id="doc-root-input"
            type="text"
            value={docRoot}
            onChange={(event) => setDocRoot(event.target.value)}
            onBlur={commitDocRoot}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            placeholder="Defaults to the nearest .git root"
            aria-label="Save location"
            title="Where dragged layout, saved docs, and analysis state are written -- defaults to the repo's .git root"
            style={{
              width: '100%',
              maxWidth: 480,
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: colors.bgPage,
              color: colors.textFaint,
              fontSize: 12,
              boxSizing: 'border-box',
            }}
          />
        </div>
      </form>

      {stats && (
        <div
          data-testid="repo-status"
          style={{ margin: `${spacing.sm}px 0 0`, fontSize: 12, color: colors.textMuted }}
        >
          {stats.path} — {stats.nodeCount} nodes, {stats.edgeCount} edges
          {stats.parseErrors.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', color: colors.matchHighlight }}>
                {stats.parseErrors.length} parse error{stats.parseErrors.length === 1 ? '' : 's'}
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {stats.parseErrors.map((err, index) => (
                  <li key={`${err.file}:${err.line ?? 0}:${index}`}>
                    {err.file}
                    {err.line !== null && `:${err.line}`} — {err.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
