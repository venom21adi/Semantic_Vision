import { useState, type KeyboardEvent } from 'react'
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
 * the checklist -- kept in sync with the backend's registered adapters
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

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

type Step = 'path' | 'languages' | 'docroot'

interface RepoLoaderProps {
  onLoad: (path: string, docRoot: string, languages: string[]) => void
  loading: boolean
  error: string | null
  initialPath?: string
  initialDocRoot?: string
  initialLanguages?: string[]
  /** The save location actually in effect after the last successful
   * load -- may differ from what was typed (e.g. auto-detected), so the
   * final step reflects reality rather than staying stuck on stale input. */
  resolvedDocRoot?: string | null
  stats: RepoLoadStats | null
  /** Whether a repository is currently loaded -- lets the final step apply
   * a save-location-only change live (via `onChangeDocRoot`) instead of
   * forcing a full reparse when the path and languages haven't changed. */
  hasLoadedRepo?: boolean
  onChangeDocRoot?: (newDocRoot: string) => void
  /** Skips the outer card border/background -- for a caller that already
   * provides its own surface (e.g. a popover), so the chrome isn't drawn
   * twice. */
  bare?: boolean
}

/** A three-step wizard for pointing the app at a repository: (1) the
 * repository path, (2) which of the languages found there to load, and
 * (3) where to save docs/layout/analysis state. Each step is a deliberate
 * choice rather than a single all-at-once form -- language detection only
 * runs once the user commits to a path, and the save location is shown
 * (with a real default) only once languages are picked. */
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
}: RepoLoaderProps) {
  const [step, setStep] = useState<Step>('path')
  const [path, setPath] = useState(initialPath ?? '')
  const [docRoot, setDocRoot] = useState(initialDocRoot ?? resolvedDocRoot ?? '')
  const [selectedLanguages, setSelectedLanguages] = useState<ReadonlySet<string>>(
    () => new Set(initialLanguages ?? []),
  )
  const [detection, setDetection] = useState<{
    detected: string[]
    supported: string[]
    default_doc_root: string
  } | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)

  function goToLanguages() {
    const trimmed = path.trim()
    if (!trimmed) return
    setDetectError(null)
    setDetecting(true)
    detectLanguages(trimmed)
      .then((result) => {
        setDetection(result)
        // Re-detecting the same path the user already made a choice for
        // (going Back and forward again) leaves that choice alone; only a
        // path this wizard hasn't seen a detection for yet gets pre-ticked.
        setSelectedLanguages((prev) =>
          prev.size === 0
            ? new Set(result.detected.filter((lang) => result.supported.includes(lang)))
            : prev,
        )
        setDocRoot((prev) => (prev.trim() ? prev : result.default_doc_root))
        setStep('languages')
      })
      .catch((err: unknown) => {
        setDetectError(err instanceof Error ? err.message : 'Could not scan that path.')
      })
      .finally(() => setDetecting(false))
  }

  function toggleLanguage(language: string) {
    setSelectedLanguages((prev) => {
      const next = new Set(prev)
      if (next.has(language)) next.delete(language)
      else next.add(language)
      return next
    })
  }

  function handleFinish() {
    const trimmedPath = path.trim()
    const trimmedDocRoot = docRoot.trim()
    const languages = Array.from(selectedLanguages)
    if (!trimmedPath || languages.length === 0) return

    const pathChanged = trimmedPath !== (initialPath ?? '')
    const languagesChanged = !sameSet(selectedLanguages, new Set(initialLanguages ?? []))
    const currentDocRoot = resolvedDocRoot ?? initialDocRoot ?? ''
    const docRootChanged = trimmedDocRoot !== currentDocRoot

    if (hasLoadedRepo && onChangeDocRoot && !pathChanged && !languagesChanged && docRootChanged) {
      onChangeDocRoot(trimmedDocRoot)
      return
    }
    onLoad(trimmedPath, trimmedDocRoot, languages)
  }

  function onEnterKey(next: () => void) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        next()
      }
    }
  }

  const supportedLanguages = detection?.supported ?? Object.keys(SUPPORTED_LANGUAGE_LABELS)
  const unsupportedDetected = (detection?.detected ?? []).filter(
    (lang) => !supportedLanguages.includes(lang),
  )

  const fieldLabelStyle = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: colors.textDim,
    marginBottom: 3,
  }

  const stepIndex = step === 'path' ? 1 : step === 'languages' ? 2 : 3

  function StepHeader({ title }: { title: string }) {
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: spacing.xs }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: colors.textDim }}>
          Step {stepIndex} of 3
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{title}</span>
      </div>
    )
  }

  function NavButtons({
    onBack,
    onNext,
    nextLabel,
    nextDisabled,
    nextLoading,
  }: {
    onBack?: () => void
    onNext: () => void
    nextLabel: string
    nextDisabled: boolean
    nextLoading?: boolean
  }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: spacing.sm }}>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
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
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className="sv-interactive"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: radius.sm,
            border: 'none',
            background: nextDisabled ? colors.disabled : colors.accent,
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: 600,
            cursor: nextDisabled ? 'default' : 'pointer',
          }}
        >
          {nextLoading && <span className="spinner" aria-hidden="true" />}
          {nextLabel}
        </button>
      </div>
    )
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
      {step === 'path' && (
        <div>
          <StepHeader title="Repository path" />
          <input
            id="repo-path-input"
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={onEnterKey(goToLanguages)}
            placeholder="e.g. C:/Users/you/projects/my-repo"
            aria-label="Repository path"
            title="Absolute path to a local repository"
            autoFocus
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
          <span style={{ display: 'block', marginTop: 5, fontSize: 11, color: colors.textDim }}>
            Running via Docker Compose? Paste the same path you set as <code>REPO_PATH</code> in{' '}
            <code>.env</code> (or a subfolder of it) — it's mapped into the container
            automatically.
          </span>
          {detectError && (
            <span role="alert" style={{ display: 'block', marginTop: 6, color: colors.danger, fontSize: 12 }}>
              {detectError}
            </span>
          )}
          <NavButtons
            onNext={goToLanguages}
            nextLabel={detecting ? 'Scanning…' : 'Next: pick languages'}
            nextDisabled={path.trim().length === 0 || detecting}
            nextLoading={detecting}
          />
        </div>
      )}

      {step === 'languages' && (
        <div>
          <StepHeader title="Which languages should be loaded?" />
          <div role="group" aria-label="Languages to parse" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {supportedLanguages.map((lang) => {
              const checked = selectedLanguages.has(lang)
              return (
                <label
                  key={lang}
                  className="sv-interactive"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: radius.sm,
                    border: `1px solid ${checked ? colors.accent : colors.border}`,
                    background: checked ? colors.accent : colors.bgPage,
                    color: colors.textPrimary,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLanguage(lang)}
                    aria-label={`Load ${languageLabel(lang)}`}
                  />
                  {languageLabel(lang)}
                </label>
              )
            })}
            {unsupportedDetected.map((lang) => (
              <div
                key={lang}
                role="note"
                title={`${languageLabel(lang)} was detected in this repository, but isn't supported yet`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: radius.sm,
                  border: `1px solid ${colors.border}`,
                  background: 'transparent',
                  color: colors.textDim,
                  fontSize: 13,
                  cursor: 'not-allowed',
                }}
              >
                <input type="checkbox" checked={false} disabled aria-label={`${languageLabel(lang)} (not supported)`} />
                {languageLabel(lang)} (detected, not supported yet)
              </div>
            ))}
            {supportedLanguages.length === 0 && unsupportedDetected.length === 0 && (
              <span style={{ fontSize: 12, color: colors.textDim }}>
                No recognized source files were found at that path.
              </span>
            )}
          </div>
          <NavButtons
            onBack={() => setStep('path')}
            onNext={() => setStep('docroot')}
            nextLabel="Next: save location"
            nextDisabled={selectedLanguages.size === 0}
          />
        </div>
      )}

      {step === 'docroot' && (
        <div>
          <StepHeader title="Where should docs and saved state live?" />
          <label
            htmlFor="doc-root-input"
            title="Where dragged layout, saved docs, and analysis state are written"
            style={fieldLabelStyle}
          >
            Save location
          </label>
          <input
            id="doc-root-input"
            type="text"
            value={docRoot}
            onChange={(event) => setDocRoot(event.target.value)}
            onKeyDown={onEnterKey(handleFinish)}
            placeholder={detection?.default_doc_root ?? "Defaults to the nearest .git root"}
            aria-label="Save location"
            style={{
              width: '100%',
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: colors.bgPage,
              color: colors.textPrimary,
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
          <span style={{ display: 'block', marginTop: 5, fontSize: 11, color: colors.textDim }}>
            This is the default location (the repository's nearest <code>.git</code> root) —
            edit it if you'd rather save elsewhere.
          </span>
          {error && (
            <span role="alert" style={{ display: 'block', marginTop: 6, color: colors.danger, fontSize: 12 }}>
              {error}
            </span>
          )}
          <NavButtons
            onBack={() => setStep('languages')}
            onNext={handleFinish}
            nextLabel={loading ? 'Loading…' : hasLoadedRepo ? 'Apply' : 'Load'}
            nextDisabled={loading}
            nextLoading={loading}
          />
        </div>
      )}

      {stats && (
        <div style={{ margin: `${spacing.sm}px 0 0`, fontSize: 12, color: colors.textMuted }}>
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
