import { useState, type FormEvent } from 'react'

interface RepoLoaderProps {
  onLoad: (path: string) => void
  loading: boolean
  error: string | null
}

export function RepoLoader({ onLoad, loading, error }: RepoLoaderProps) {
  const [path, setPath] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = path.trim()
    if (trimmed) onLoad(trimmed)
  }

  return (
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
          padding: '6px 14px',
          borderRadius: 4,
          border: 'none',
          background: loading ? '#475569' : '#2563eb',
          color: '#f8fafc',
          fontSize: 13,
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Loading…' : 'Load'}
      </button>
      {error && (
        <span role="alert" style={{ color: '#fca5a5', fontSize: 13 }}>
          {error}
        </span>
      )}
    </form>
  )
}
