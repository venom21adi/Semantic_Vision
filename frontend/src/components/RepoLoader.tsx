import { useEffect, useState, type FormEvent } from 'react'
import { detectLanguages } from '../api/client'
import type { ParseErrorInfo } from '../api/types'
import { colors, radius, spacing } from '../theme'

export interface RepoLoadStats {
  path: string
  nodeCount: number
  edgeCount: number
  parseErrors: ParseErrorInfo[]
}

/** Every language this build knows how to parse, and how it's labeled in
 * the chip row -- kept in sync with the backend's registered adapters
 * (`languages/registry.py`) by hand, same as the old `<select>`'s
 * hardcoded `<option>` list this replaces. */
const SUPPORTED_LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript / TypeScript',
  java: 'Java',
}

export function languageLabel(language: string): string {
  return SUPPORTED_LANGUAGE_LABELS[language] ?? language
}

interface RepoLoaderProps {
  onLoad: (path: string, docRoot: string, languages: string[]) => void
  loading: boolean
  error: string | null
  initialPath?: string
  initialDocRoot?: string
  initialLanguages?: string[]
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
  initialLanguages,
  resolvedDocRoot,
  stats,
  hasLoadedRepo = false,
  onChangeDocRoot,
  bare = false,
  stacked = false,
}: RepoLoaderProps) {
  const [path, setPath] = useState(initialPath ?? '')
  const [docRoot, setDocRoot] = useState(initialDocRoot ?? '')
  // Empty by default (not pre-seeded with a language) so the very first
  // successful detection for a freshly-typed path can pre-check its
  // findings -- see the detection effect below. A repeat visit still seeds
  // straight from `initialLanguages` (the user's own past choice for this
  // path), which detection then leaves alone.
  const [selectedLanguages, setSelectedLanguages] = useState<ReadonlySet<string>>(
    () => new Set(initialLanguages ?? []),
  )
  // Which languages were actually found in `path`, and which of those this
  // build knows how to parse -- `null` before the first successful
  // detection (or while `path` is empty), so the chip row can tell "not
  // checked yet" apart from "checked, found nothing".
  const [detection, setDetection] = useState<{ detected: string[]; supported: string[] } | null>(
    null,
  )
  const [detecting, setDetecting] = useState(false)

  // Debounced so typing a path doesn't fire one detection request per
  // keystroke -- mirrors `App.tsx`'s own `useDebouncedValue` pattern for
  // the same reason (settle before paying for a request).
  const [debouncedPath, setDebouncedPath] = useState(path)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPath(path), 400)
    return () => clearTimeout(timer)
  }, [path])

  useEffect(() => {
    const trimmed = debouncedPath.trim()
    if (!trimmed) {
      setDetection(null)
      return
    }
    let cancelled = false
    setDetecting(true)
    detectLanguages(trimmed)
      .then((result) => {
        if (cancelled) return
        setDetection(result)
        // Pre-check every detected, supported language -- but only on the
        // very first successful detection for a freshly-typed path (an
        // empty `initialLanguages`-seeded default): once the user has
        // deliberately checked/unchecked anything, later detections (e.g.
        // re-typing the same path) shouldn't silently reset their choice.
        setSelectedLanguages((prev) =>
          prev.size === 0
            ? new Set(result.detected.filter((lang) => result.supported.includes(lang)))
            : prev,
        )
      })
      .catch(() => {
        // Best-effort: detection failing (bad path, backend unreachable)
        // just means the chip row falls back to "nothing detected yet" --
        // the user can still check languages manually and submit.
        if (!cancelled) setDetection(null)
      })
      .finally(() => {
        if (!cancelled) setDetecting(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedPath])

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

  function toggleLanguage(language: string) {
    setSelectedLanguages((prev) => {
      const next = new Set(prev)
      if (next.has(language)) next.delete(language)
      else next.add(language)
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = path.trim()
    if (trimmed && selectedLanguages.size > 0) {
      onLoad(trimmed, docRoot.trim(), Array.from(selectedLanguages))
    }
  }

  // The chip row itself: every supported language, checked/unchecked by
  // `selectedLanguages`, plus a detected-but-unsupported language shown
  // disabled with an explanatory tooltip -- so a polyglot repo's
  // unsupported half doesn't just silently vanish with no explanation.
  const supportedLanguages = detection?.supported ?? Object.keys(SUPPORTED_LANGUAGE_LABELS)
  const unsupportedDetected = (detection?.detected ?? []).filter(
    (lang) => !supportedLanguages.includes(lang),
  )

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
          <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: stacked ? 1 : undefined }}>
              <span style={fieldLabelStyle}>
                Languages{detecting ? ' (detecting…)' : ''}
              </span>
              <div
                role="group"
                aria-label="Languages to parse"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: stacked ? undefined : 260 }}
              >
                {supportedLanguages.map((lang) => {
                  const checked = selectedLanguages.has(lang)
                  return (
                    <button
                      key={lang}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleLanguage(lang)}
                      className="sv-interactive"
                      title={`Parse this repository's ${languageLabel(lang)} files`}
                      style={{
                        padding: '5px 10px',
                        borderRadius: radius.full,
                        border: `1px solid ${checked ? colors.accent : colors.border}`,
                        background: checked ? colors.accent : colors.bgPage,
                        color: colors.textPrimary,
                        fontSize: 12,
                        fontWeight: checked ? 600 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {languageLabel(lang)}
                    </button>
                  )
                })}
                {unsupportedDetected.map((lang) => (
                  <span
                    key={lang}
                    role="note"
                    aria-label={`${languageLabel(lang)} was detected in this repository, but isn't supported yet`}
                    title={`${languageLabel(lang)} was detected in this repository, but isn't supported yet`}
                    style={{
                      padding: '5px 10px',
                      borderRadius: radius.full,
                      border: `1px solid ${colors.border}`,
                      background: 'transparent',
                      color: colors.textDim,
                      fontSize: 12,
                      cursor: 'not-allowed',
                    }}
                  >
                    {languageLabel(lang)} (not supported)
                  </span>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || path.trim().length === 0 || selectedLanguages.size === 0}
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
