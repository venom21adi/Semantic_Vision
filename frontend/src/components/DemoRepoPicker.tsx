import { useEffect, useState } from 'react'
import { loadDemoRepoList, type DemoRepoMeta } from '../api/demoClient'
import { languageLabel } from './RepoLoader'
import { colors, radius, spacing } from '../theme'

interface DemoRepoPickerProps {
  onLoad: (path: string, docRoot: string, languages: string[]) => void
  loading: boolean
  error: string | null
}

/** Replaces `RepoLoader` in the static demo build's empty state -- there's
 * no filesystem to type a path into, so step one offers the precomputed
 * repos as cards instead of a path field. Step two mirrors `RepoLoader`'s
 * own language-confirmation step, even though a demo repo only ever has
 * one fixed language to confirm (never polyglot) and there's no
 * save-location step -- a demo build never persists anything. Still calls
 * the same `onLoad(path, docRoot, languages)` signature `App.tsx` already
 * wires up, with `path` set to the repo's demo slug (see `demoClient.ts`). */
export function DemoRepoPicker({ onLoad, loading, error }: DemoRepoPickerProps) {
  const [repos, setRepos] = useState<DemoRepoMeta[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DemoRepoMeta | null>(null)

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

  if (selected) {
    return (
      <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: spacing.sm }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: colors.textDim }}>Step 2 of 2</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
            Confirm the language to load
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: radius.sm,
            border: `1px solid ${colors.accent}`,
            background: colors.accent,
            color: colors.textPrimary,
            fontSize: 13,
          }}
        >
          <input type="checkbox" checked readOnly aria-label={`Load ${languageLabel(selected.language)}`} />
          {languageLabel(selected.language)}
        </div>
        <span style={{ display: 'block', marginTop: 5, fontSize: 11, color: colors.textDim }}>
          {selected.displayName} is a fixed single-language demo repo, so there's nothing else to
          pick — and nothing is saved in demo mode, so there's no save-location step either.
        </span>
        {error && (
          <span role="alert" style={{ display: 'block', marginTop: 6, color: colors.danger, fontSize: 12 }}>
            {error}
          </span>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="sv-interactive"
            style={{
              padding: '6px 14px',
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.textMuted,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => onLoad(selected.slug, '', [selected.language])}
            className="sv-interactive"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 16px',
              borderRadius: radius.sm,
              border: 'none',
              background: loading ? colors.disabled : colors.accent,
              color: colors.textPrimary,
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: colors.textDim }}>Step 1 of 2</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
          Choose a demo repository
        </span>
      </div>
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
            onClick={() => setSelected(repo)}
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
