import type { ReactNode } from 'react'
import type { ComplexityChange, ComplexityDiffResponse, ComplexityScore } from '../api/types'
import { colors, spacing } from '../theme'
import { PerformanceReportPane } from './PerformanceReportPane'

export type DashboardState =
  | { status: 'loading' }
  | { status: 'loaded'; scores: ComplexityScore[] }
  | { status: 'error'; message: string }

/** The before/after "Compare to last look" flow (Idea 3b of
 * docs/ideas/CODE-HEALTH-DASHBOARD-IDEAS.md) -- independent of `DashboardState`
 * itself, since a compare is an action taken *within* an already-loaded dashboard,
 * not a different way of loading one. */
export type DiffState =
  | { status: 'loading' }
  | { status: 'loaded'; result: ComplexityDiffResponse }
  | { status: 'error'; message: string }

interface DashboardViewProps {
  state: DashboardState
  path: string
  onSelectNode: (nodeId: string) => void
  onBack: () => void
  diff: DiffState | null
  onCompare: () => void
}

/** The standalone code-health dashboard -- see
 * docs/ideas/CODE-HEALTH-DASHBOARD-IDEAS.md's Idea 1. Structurally modeled on
 * `flowchart/FlowchartCanvas.tsx` (full-width wrapper, header bar with a "Back to
 * graph" button, content below), except it owns all three status branches itself
 * rather than pushing loading/error into `App.tsx` -- a shared header makes sense
 * across all three here, and `App.tsx` is already large. */
export function DashboardView({ state, path, onSelectNode, onBack, diff, onCompare }: DashboardViewProps) {
  const compareDisabled = state.status !== 'loaded' || diff?.status === 'loading'

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: `1px solid ${colors.bgPanel}`,
          background: colors.bgPage,
          color: colors.textPrimary,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        <div>
          <div>Code Health Dashboard</div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
            Complexity today — more signals land here as they ship.
          </div>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0 }}>
          <button
            onClick={onCompare}
            disabled={compareDisabled}
            className="sv-interactive"
            title="Re-parse the repo and compare its complexity against the last time this dashboard fetched it -- see what an edit changed"
            style={{
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: compareDisabled ? colors.textDim : colors.textPrimary,
              padding: '4px 10px',
              fontSize: 12,
              cursor: compareDisabled ? 'default' : 'pointer',
            }}
          >
            {diff?.status === 'loading' ? 'Comparing…' : 'Compare to last look'}
          </button>
          <button
            onClick={onBack}
            className="sv-interactive"
            style={{
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: colors.textPrimary,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Back to graph
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: spacing.lg }}>
        {state.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
        {state.status === 'error' && (
          <p role="alert" style={{ color: colors.danger }}>
            {state.message}
          </p>
        )}
        {state.status === 'loaded' && (
          <>
            {diff && <DiffPanel diff={diff} onSelectNode={onSelectNode} />}
            <PerformanceReportPane path={path} scores={state.scores} onSelectNode={onSelectNode} />
          </>
        )}
      </div>
    </div>
  )
}

function DiffPanel({ diff, onSelectNode }: { diff: DiffState; onSelectNode: (nodeId: string) => void }) {
  if (diff.status === 'loading') {
    return <p style={{ color: colors.textMuted }}>Comparing…</p>
  }
  if (diff.status === 'error') {
    return (
      <p role="alert" style={{ color: colors.danger, marginBottom: spacing.lg }}>
        {diff.message}
      </p>
    )
  }

  const { result } = diff
  if (!result.available) {
    return (
      <p style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
        No earlier snapshot to compare against yet.
      </p>
    )
  }
  if (result.added.length === 0 && result.removed.length === 0 && result.changed.length === 0) {
    return (
      <p style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
        No changes since the last look.
      </p>
    )
  }

  return (
    <div
      style={{
        marginBottom: spacing.lg,
        paddingBottom: spacing.md,
        borderBottom: `1px solid ${colors.bgPanel}`,
      }}
    >
      {result.changed.length > 0 && (
        <DiffSection title="Changed" count={result.changed.length}>
          {result.changed.map((change) => (
            <ChangedRow key={change.node_id} change={change} onSelectNode={onSelectNode} />
          ))}
        </DiffSection>
      )}
      {result.added.length > 0 && (
        <DiffSection title="Added" count={result.added.length}>
          {result.added.map((score) => (
            <ScoreRow key={score.node_id} score={score} onSelectNode={onSelectNode} />
          ))}
        </DiffSection>
      )}
      {result.removed.length > 0 && (
        <DiffSection title="Removed" count={result.removed.length}>
          {result.removed.map((score) => (
            // Plain text, not a button: the node no longer exists in the
            // refreshed graph, so selecting it would silently do nothing.
            <div key={score.node_id} style={{ fontSize: 12, color: colors.textDim, padding: '2px 0' }}>
              {score.node_id} <span>(complexity {score.cyclomatic_complexity})</span>
            </div>
          ))}
        </DiffSection>
      )}
    </div>
  )
}

function DiffSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <div style={{ marginBottom: spacing.sm }}>
      <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: colors.textMuted, margin: `0 0 ${spacing.xs}px` }}>
        {title} <span style={{ color: colors.textDim }}>({count})</span>
      </h4>
      {children}
    </div>
  )
}

function ScoreRow({
  score,
  onSelectNode,
}: {
  score: ComplexityScore
  onSelectNode: (nodeId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectNode(score.node_id)}
      className="sv-interactive"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: colors.textPrimary,
        padding: '2px 0',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {score.node_id} <span style={{ color: colors.textDim }}>(complexity {score.cyclomatic_complexity})</span>
    </button>
  )
}

function ChangedRow({
  change,
  onSelectNode,
}: {
  change: ComplexityChange
  onSelectNode: (nodeId: string) => void
}) {
  const delta = change.after.cyclomatic_complexity - change.before.cyclomatic_complexity
  const deltaColor = delta > 0 ? colors.danger : delta < 0 ? colors.success : colors.textDim
  return (
    <button
      type="button"
      onClick={() => onSelectNode(change.node_id)}
      className="sv-interactive"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: colors.textPrimary,
        padding: '2px 0',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {change.node_id}{' '}
      <span style={{ color: deltaColor }}>
        (complexity {change.before.cyclomatic_complexity} → {change.after.cyclomatic_complexity})
      </span>
    </button>
  )
}
