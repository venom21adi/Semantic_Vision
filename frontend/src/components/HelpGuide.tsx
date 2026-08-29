import { useEffect, useRef, useState } from 'react'
import { colors, radius, spacing } from '../theme'

/** The "?" affordance in the header -- a lightweight popover walking
 * through the whole product loop (load -> explore -> right-click actions
 * -> scope the canvas -> deeper analysis), since nothing else in the app
 * explains itself to a first-time visitor beyond the empty-state's one
 * line. Kept as a dismissible popover rather than a modal so it never
 * blocks the graph underneath -- this is meant to be glanced at, not
 * read start-to-finish before you can do anything. */
export function HelpGuide() {
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

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-label="How to use Semantic Vision"
        title="How to use Semantic Vision"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="sv-interactive"
        style={{
          width: 26,
          height: 26,
          borderRadius: radius.full,
          border: `1px solid ${colors.border}`,
          background: open ? colors.accent : 'transparent',
          color: colors.textPrimary,
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="How to use Semantic Vision"
          style={{
            position: 'absolute',
            top: '130%',
            right: 0,
            width: 320,
            zIndex: 30,
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            padding: spacing.md,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.sm,
            }}
          >
            <strong style={{ fontSize: 13 }}>How to use Semantic Vision</strong>
            <button
              type="button"
              aria-label="Close"
              title="Close"
              onClick={() => setOpen(false)}
              className="sv-interactive"
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.textMuted,
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12,
              color: colors.textMuted,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing.xs,
            }}
          >
            <li>
              Paste an absolute path to a local repo, pick a language, and click{' '}
              <strong style={{ color: colors.textPrimary }}>Load</strong>.
            </li>
            <li>Explore the graph — drag nodes, scroll to zoom, drag empty space to pan.</li>
            <li>
              Right-click any node for <strong style={{ color: colors.textPrimary }}>Document</strong>,{' '}
              <strong style={{ color: colors.textPrimary }}>Impact Analysis</strong>,{' '}
              <strong style={{ color: colors.textPrimary }}>View Source</strong>, or{' '}
              <strong style={{ color: colors.textPrimary }}>Execution Flowchart</strong>.
            </li>
            <li>
              Large repos start empty on purpose — use the sidebar checkboxes (or{' '}
              <strong style={{ color: colors.textPrimary }}>Expand all</strong>) to choose what's on
              the canvas.
            </li>
            <li>
              Toggle <strong style={{ color: colors.textPrimary }}>Show complexity</strong> or{' '}
              <strong style={{ color: colors.textPrimary }}>Add tables &amp; models</strong> in the
              sidebar for deeper analysis; once tables are on the graph, filter to them with{' '}
              <strong style={{ color: colors.textPrimary }}>Data only</strong>.
            </li>
          </ol>
        </div>
      )}
    </div>
  )
}
