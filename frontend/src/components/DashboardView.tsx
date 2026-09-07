import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  ComplexityChange,
  ComplexityDiffResponse,
  ComplexityRefDiffResponse,
  ComplexityScore,
  GraphEdge,
  GraphNode,
} from '../api/types'
import { MiniCallGraph } from '../graph/MiniCallGraph'
import { colors, spacing } from '../theme'
import { getDashboardSplitWidth, setDashboardSplitWidth } from '../utils/localStorage'
import { PerformanceReportPane } from './PerformanceReportPane'
import { RefPicker, type GitRefsState } from './RefPicker'
import { SummaryStatsHeader } from './SummaryStatsHeader'

export type DashboardState =
  | { status: 'loading' }
  | { status: 'loaded'; scores: ComplexityScore[] }
  | { status: 'error'; message: string }

/** Tags *how* a `DiffState`'s result was produced -- "vs last look" (Idea
 * 3b) or "vs an arbitrary git ref" (Idea 3a). One `DiffState` shape
 * handles both rather than two parallel state variables: a second
 * dashboard-scoped state slice not wired into every close/invalidate
 * call site is exactly the shape of bug this dashboard has shipped
 * twice already (see App.tsx's `closeDashboard`). */
export type DiffMode =
  | { kind: 'last-look' }
  | { kind: 'ref'; ref: string; label: string; toRef?: string; toLabel?: string }

export type DiffState =
  | { status: 'loading'; mode: DiffMode }
  | { status: 'loaded'; mode: DiffMode; result: ComplexityDiffResponse | ComplexityRefDiffResponse }
  | { status: 'error'; mode: DiffMode; message: string }

interface DashboardViewProps {
  state: DashboardState
  path: string
  onSelectNode: (nodeId: string) => void
  onBack: () => void
  diff: DiffState | null
  onCompare: () => void
  gitRefs: GitRefsState | null
  onCompareToRef: (ref: string, label: string, toRef?: string, toLabel?: string) => void
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
  selectedNodeId: string | null
}

const MIN_LIST_WIDTH = 360
const MAX_LIST_WIDTH = 900
const MIN_GRAPH_WIDTH = 280
const DEFAULT_LIST_WIDTH = 520

function clampListWidth(width: number): number {
  const viewportMax = typeof window === 'undefined' ? MAX_LIST_WIDTH : window.innerWidth - MIN_GRAPH_WIDTH
  return Math.min(Math.max(width, MIN_LIST_WIDTH), Math.min(MAX_LIST_WIDTH, viewportMax))
}

/** A drag handle between the list and mini-graph panes -- mirrors
 * `DetailsPanel.tsx`'s `ResizeHandle` (pointermove drag, arrow-key step,
 * clamped width) for visual/interaction consistency with the app's only
 * other resizable split, rather than a new one-off implementation. Not
 * imported directly since that component isn't exported and its clamp
 * constants are `DetailsPanel`-specific. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const [dragStart, setDragStart] = useState<{ pointerX: number; startWidth: number } | null>(null)

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      setDragStart({ pointerX: event.clientX, startWidth: width })
    },
    [width],
  )

  useEffect(() => {
    if (!dragStart) return
    const { pointerX, startWidth } = dragStart

    function handlePointerMove(event: PointerEvent) {
      onResize(clampListWidth(startWidth + (event.clientX - pointerX)))
    }
    function handlePointerUp() {
      setDragStart(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragStart, onResize])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const step = 16
      if (event.key === 'ArrowLeft') onResize(clampListWidth(width - step))
      else if (event.key === 'ArrowRight') onResize(clampListWidth(width + step))
    },
    [width, onResize],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize dashboard panes"
      aria-valuenow={width}
      aria-valuemin={MIN_LIST_WIDTH}
      aria-valuemax={MAX_LIST_WIDTH}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className="sv-resize-handle"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: -4,
        width: 8,
        cursor: 'col-resize',
        touchAction: 'none',
        zIndex: 1,
      }}
    />
  )
}

/** The standalone code-health dashboard -- see
 * docs/ideas/CODE-HEALTH-DASHBOARD-IDEAS.md's Idea 1. A resizable split:
 * the ranked list (plus an at-a-glance summary and any active diff) on
 * the left, a read-only call-depth graph on the right, mirroring
 * `DetailsPanel.tsx`'s two-pane pattern rather than inventing a new one. */
export function DashboardView({
  state,
  path,
  onSelectNode,
  onBack,
  diff,
  onCompare,
  gitRefs,
  onCompareToRef,
  graphNodes,
  graphEdges,
  selectedNodeId,
}: DashboardViewProps) {
  const compareDisabled = state.status !== 'loaded' || diff?.status === 'loading'
  const [listWidth, setListWidthState] = useState(() => clampListWidth(getDashboardSplitWidth() ?? DEFAULT_LIST_WIDTH))

  const handleResizeListWidth = useCallback((width: number) => {
    setListWidthState(width)
  }, [])

  // Debounced the same way `App.tsx`'s own `detailsWidth` persistence is
  // (a drag fires `onResize` on every pointermove) -- one settled write
  // per drag, not one per pixel.
  useEffect(() => {
    const timer = setTimeout(() => setDashboardSplitWidth(listWidth), 300)
    return () => clearTimeout(timer)
  }, [listWidth])

  const scores = state.status === 'loaded' ? state.scores : []
  const scoredNodeIds = new Set(scores.map((score) => score.node_id))
  const graphScopedNodes = graphNodes.filter((node) => scoredNodeIds.has(node.id))

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
          gap: spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div>Code Health Dashboard</div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
            Complexity today — more signals land here as they ship.
          </div>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0, alignItems: 'center' }}>
          <RefPicker state={gitRefs} disabled={compareDisabled} onCompare={onCompareToRef} />
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
            {diff?.status === 'loading' && diff.mode.kind === 'last-look' ? 'Comparing…' : 'Compare to last look'}
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
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ position: 'relative', width: listWidth, flexShrink: 0, overflowY: 'auto', padding: spacing.lg }}>
          {state.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
          {state.status === 'error' && (
            <p role="alert" style={{ color: colors.danger }}>
              {state.message}
            </p>
          )}
          {state.status === 'loaded' && (
            <>
              <SummaryStatsHeader scores={state.scores} />
              {diff && <DiffPanel diff={diff} onSelectNode={onSelectNode} />}
              <PerformanceReportPane path={path} scores={state.scores} onSelectNode={onSelectNode} />
            </>
          )}
          <ResizeHandle width={listWidth} onResize={handleResizeListWidth} />
        </div>
        <div style={{ flex: 1, minWidth: MIN_GRAPH_WIDTH, borderLeft: `1px solid ${colors.bgPanel}` }}>
          <MiniCallGraph
            nodes={graphScopedNodes}
            edges={graphEdges}
            scores={scores}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
          />
        </div>
      </div>
    </div>
  )
}

function diffModeLabel(mode: DiffMode): string {
  if (mode.kind === 'last-look') return 'vs last look'
  return mode.toLabel ? `${mode.label} → ${mode.toLabel}` : `vs ${mode.label}`
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

  const { result, mode } = diff
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
        No changes {diffModeLabel(mode)}.
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
      <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: colors.textMuted, margin: `0 0 ${spacing.xs}px` }}>
        Changes {diffModeLabel(mode)}
      </h4>
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
