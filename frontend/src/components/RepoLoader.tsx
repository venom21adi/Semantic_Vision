import { useState, type FormEvent } from 'react'
import type { ParseErrorInfo } from '../api/types'

export interface RepoLoadStats {
  path: string
  nodeCount: number
  edgeCount: number
  parseErrors: ParseErrorInfo[]
}

interface RepoLoaderProps {
  onLoad: (path: string, docRoot: string) => void
  loading: boolean
  error: string | null
  initialPath?: string
  initialDocRoot?: string
  /** The save location actually in effect after the last successful
   * load -- may differ from what was typed (e.g. auto-detected), so the
   * field reflects reality rather than staying stuck on stale input. */
  resolvedDocRoot?: string | null
  stats: RepoLoadStats | null
}

export function RepoLoader({
  onLoad,
  loading,
  error,
  initialPath,
  initialDocRoot,
  resolvedDocRoot,
  stats,
}: RepoLoaderProps) {
  const [path, setPath] = useState(initialPath ?? '')
  const [docRoot, setDocRoot] = useState(initialDocRoot ?? '')

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
    if (trimmed) onLoad(trimmed, docRoot.trim())
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="Absolute path to a Python repository"
            aria-label="Repository path"
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#f8fafc',
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            disabled={loading || path.trim().length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 4,
              border: 'none',
              background: loading ? '#475569' : '#2563eb',
              color: '#f8fafc',
              fontSize: 13,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Loading…' : 'Load'}
          </button>
          {error && (
            <span role="alert" style={{ color: '#fca5a5', fontSize: 13 }}>
              {error}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <label
            htmlFor="doc-root-input"
            style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}
          >
            Save location
          </label>
          <input
            id="doc-root-input"
            type="text"
            value={docRoot}
            onChange={(event) => setDocRoot(event.target.value)}
            placeholder="Defaults to the nearest .git root"
            aria-label="Save location"
            style={{
              flex: 1,
              maxWidth: 480,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #1e293b',
              background: '#0f172a',
              color: '#94a3b8',
              fontSize: 11,
            }}
          />
        </div>
      </form>

      {stats && (
        <div data-testid="repo-status" style={{ margin: '8px 0 0', fontSize: 12, color: '#94a3b8' }}>
          {stats.path} — {stats.nodeCount} nodes, {stats.edgeCount} edges
          {stats.parseErrors.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', color: '#fbbf24' }}>
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
