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

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
          <input
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="Absolute path to a repository"
            aria-label="Repository path"
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: colors.bgPage,
              color: colors.textPrimary,
              fontSize: 13,
            }}
          />
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            aria-label="Language"
            style={{
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
          <button
            type="submit"
            disabled={loading || path.trim().length === 0}
            className="sv-interactive"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: radius.sm,
              border: 'none',
              background: loading ? colors.disabled : colors.accent,
              color: colors.textPrimary,
              fontSize: 13,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Loading…' : 'Load'}
          </button>
          {error && (
            <span role="alert" style={{ color: colors.danger, fontSize: 13 }}>
              {error}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginTop: 6 }}>
          <label
            htmlFor="doc-root-input"
            style={{ fontSize: 11, color: colors.textDim, whiteSpace: 'nowrap' }}
          >
            Save location
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
            style={{
              flex: 1,
              maxWidth: 480,
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
              border: `1px solid ${colors.bgPanel}`,
              background: colors.bgPage,
              color: colors.textMuted,
              fontSize: 11,
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
