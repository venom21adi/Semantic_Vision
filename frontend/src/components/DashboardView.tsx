import type { ComplexityScore } from '../api/types'
import { colors, spacing } from '../theme'
import { PerformanceReportPane } from './PerformanceReportPane'

export type DashboardState =
  | { status: 'loading' }
  | { status: 'loaded'; scores: ComplexityScore[] }
  | { status: 'error'; message: string }

interface DashboardViewProps {
  state: DashboardState
  path: string
  onSelectNode: (nodeId: string) => void
  onBack: () => void
}

/** The standalone code-health dashboard -- see
 * docs/ideas/CODE-HEALTH-DASHBOARD-IDEAS.md's Idea 1. Structurally modeled on
 * `flowchart/FlowchartCanvas.tsx` (full-width wrapper, header bar with a "Back to
 * graph" button, content below), except it owns all three status branches itself
 * rather than pushing loading/error into `App.tsx` -- a shared header makes sense
 * across all three here, and `App.tsx` is already large. */
export function DashboardView({ state, path, onSelectNode, onBack }: DashboardViewProps) {
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
      <div style={{ flex: 1, overflowY: 'auto', padding: spacing.lg }}>
        {state.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
        {state.status === 'error' && (
          <p role="alert" style={{ color: colors.danger }}>
            {state.message}
          </p>
        )}
        {state.status === 'loaded' && (
          <PerformanceReportPane path={path} scores={state.scores} onSelectNode={onSelectNode} />
        )}
      </div>
    </div>
  )
}
