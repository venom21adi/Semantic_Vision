import { useEffect, useState } from 'react'
import { loadDemoRepoList } from '../api/demoClient'
import { colors, radius, spacing } from '../theme'

interface DemoRepoPillProps {
  slug: string
  onSwitch: () => void
}

/** Replaces the editable `RepoPill` in the header once a demo repo is
 * loaded -- there's no real path/doc-root to change in a static deploy,
 * just a fixed set of precomputed repos, so this is a plain label plus a
 * button back to `DemoRepoPicker`. */
export function DemoRepoPill({ slug, onSwitch }: DemoRepoPillProps) {
  const [displayName, setDisplayName] = useState(slug)

  useEffect(() => {
    let cancelled = false
    loadDemoRepoList()
      .then((list) => {
        if (cancelled) return
        const match = list.find((repo) => repo.slug === slug)
        if (match) setDisplayName(match.displayName)
      })
      .catch(() => {
        // Best-effort label -- the slug itself is still a reasonable fallback.
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, minWidth: 0 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: colors.textPrimary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </span>
      <button
        type="button"
        onClick={onSwitch}
        className="sv-interactive"
        style={{
          flexShrink: 0,
          fontSize: 11,
          padding: '3px 8px',
          borderRadius: radius.full,
          border: `1px solid ${colors.border}`,
          background: 'transparent',
          color: colors.textMuted,
          cursor: 'pointer',
        }}
      >
        Switch demo repo
      </button>
    </div>
  )
}
