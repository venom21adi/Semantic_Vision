import { useState, type FormEvent } from 'react'
import type { ParseErrorInfo } from '../api/types'

export interface RepoLoadStats {
  path: string
  nodeCount: number
  edgeCount: number
  parseErrors: ParseErrorInfo[]
}

interface RepoLoaderProps {
  onLoad: (path: string) => void
  loading: boolean
  error: string | null
  initialPath?: string
  stats: RepoLoadStats | null
}

export function RepoLoader({ onLoad, loading, error, initialPath, stats }: RepoLoaderProps) {
  const [path, setPath] = useState(initialPath ?? '')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = path.trim()
    if (trimmed) onLoad(trimmed)
  }

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
