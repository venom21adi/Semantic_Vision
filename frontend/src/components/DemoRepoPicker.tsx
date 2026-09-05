import { useEffect, useState } from 'react'
import { loadDemoRepoList, type DemoRepoMeta } from '../api/demoClient'
import { colors, radius, spacing } from '../theme'

interface DemoRepoPickerProps {
  onLoad: (path: string, docRoot: string, language: string) => void
  loading: boolean
  error: string | null
}

/** Replaces `RepoLoader` in the static demo build's empty state -- there's
 * no filesystem to type a path into, so this offers the two precomputed
 * repos as cards instead. Still calls the same `onLoad(path, docRoot,
 * language)` signature `App.tsx` already wires up, with `path` set to the
 * repo's demo slug (see `demoClient.ts`). */
export function DemoRepoPicker({ onLoad, loading, error }: DemoRepoPickerProps) {
  const [repos, setRepos] = useState<DemoRepoMeta[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDemoRepoList()
      .then((list) => {
        if (!cancelled) setRepos(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load demo repos')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, width: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: spacing.md,
        }}
      >
        {(repos ?? []).map((repo) => (
          <button
            key={repo.slug}
            type="button"
            disabled={loading}
            onClick={() => onLoad(repo.slug, '', repo.language)}
            className="sv-interactive"
            style={{
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.xs,
              padding: spacing.md,
              borderRadius: radius.md,
              border: `1px solid ${colors.border}`,
              background: colors.bgPanel,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
                {repo.displayName}
              </span>
              {repo.hasDataLineage && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: colors.accent,
                    border: `1px solid ${colors.accent}`,
                    borderRadius: radius.full,
                    padding: '1px 6px',
                  }}
                >
                  Data lineage
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: colors.textMuted, lineHeight: 1.5 }}>
              {repo.description}
            </p>
            <span style={{ fontSize: 10.5, color: colors.textDim }}>
              {repo.nodeCount} nodes · {repo.edgeCount} edges
            </span>
          </button>
        ))}
        {repos === null && !loadError && (
          <div style={{ fontSize: 12, color: colors.textDim }}>Loading demo repos…</div>
        )}
      </div>
      {(error || loadError) && (
        <div style={{ fontSize: 12, color: colors.danger }}>{error ?? loadError}</div>
      )}
    </div>
  )
}
