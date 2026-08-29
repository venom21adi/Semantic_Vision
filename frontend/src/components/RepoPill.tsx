import { useEffect, useRef, useState } from 'react'
import { colors, radius, spacing } from '../theme'
import { RepoLoader, type RepoLoadStats } from './RepoLoader'

interface RepoPillProps {
  stats: RepoLoadStats
  onLoad: (path: string, docRoot: string, language: string) => void
  loading: boolean
  error: string | null
  initialPath?: string
  initialDocRoot?: string
  initialLanguage?: string
  resolvedDocRoot?: string | null
  onChangeDocRoot?: (newDocRoot: string) => void
}

/** Once a repo is loaded, the full load form (path/language/save location)
 * has nothing left to do most of the time -- it just sits in the header
 * taking up space. This collapses it down to a compact "current repo"
 * pill that opens the same form in a popover, so switching or re-pointing
 * the repo is still one click away without permanently occupying the
 * header. Mirrors `HelpGuide`'s popover-with-outside-click pattern. */
export function RepoPill({
  stats,
  onLoad,
  loading,
  error,
  initialPath,
  initialDocRoot,
  initialLanguage,
  resolvedDocRoot,
  onChangeDocRoot,
}: RepoPillProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  // A repo loaded from a nested path is more recognizable by its folder
  // name than its full path -- the pill is meant to be glanceable, the
  // full path is still right there in the popover once opened.
  const repoName = stats.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || stats.path

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 1, minWidth: 0 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Current repository: ${repoName}. Click to change.`}
        title="Click to change the repository, language, or save location"
        onClick={() => setOpen((prev) => !prev)}
        className="sv-interactive"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          maxWidth: '100%',
          padding: '5px 10px',
          borderRadius: radius.full,
          border: `1px solid ${colors.border}`,
          background: open ? colors.bgPanel : 'transparent',
          color: colors.textPrimary,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 600,
          }}
        >
          {repoName}
        </span>
        <span style={{ color: colors.textDim, whiteSpace: 'nowrap' }}>
          {stats.nodeCount} nodes, {stats.edgeCount} edges
        </span>
        <span aria-hidden="true" style={{ color: colors.textDim, fontSize: 10 }}>
          {open ? '▲' : '▾'}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Change repository"
          style={{
            position: 'absolute',
            top: '130%',
            left: 0,
            width: 380,
            zIndex: 30,
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            padding: spacing.md,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
          }}
        >
          <RepoLoader
            bare
            stacked
            onLoad={onLoad}
            loading={loading}
            error={error}
            initialPath={initialPath}
            initialDocRoot={initialDocRoot}
            initialLanguage={initialLanguage}
            resolvedDocRoot={resolvedDocRoot}
            hasLoadedRepo
            onChangeDocRoot={onChangeDocRoot}
            stats={stats}
          />
        </div>
      )}
    </div>
  )
}
