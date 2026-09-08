import {
  useCallback,
  useEffect,
  useMemo,
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
  DeadCodeResponse,
  GraphEdge,
  GraphNode,
  HotspotsResponse,
} from '../api/types'
import { LARGE_GRAPH_NODE_THRESHOLD } from '../graph/GraphCanvas'
import { MiniCallGraph } from '../graph/MiniCallGraph'
import { colors, radius, spacing } from '../theme'
import { getDashboardSplitWidth, setDashboardSplitWidth } from '../utils/localStorage'
import { DeadCodeReportPane } from './DeadCodeReportPane'
import { HotspotReportPane } from './HotspotReportPane'
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

/** The Hotspots tab's data, lazily fetched -- unlike `state`/`gitRefs`,
 * which both fetch eagerly the moment the dashboard opens (see
 * `App.tsx`'s `handleToggleDashboard`), this is only requested the first
 * time the Hotspots tab is actually selected. `windowDays` travels with
 * each variant (not just a separate piece of state) so a response can
 * always be matched back to the selector value that requested it. */
export type HotspotsState =
  | { status: 'loading'; windowDays: number }
  | { status: 'loaded'; windowDays: number; result: HotspotsResponse }
  | { status: 'error'; windowDays: number; message: string }

/** The Dead Code tab's data -- same lazy-fetch-on-first-open treatment as
 * `HotspotsState` above, and cleared by the same `closeDashboard`
 * chokepoint in App.tsx. No parameter to carry alongside each variant
 * (unlike `HotspotsState`'s `windowDays`): dead-code detection has no
 * user-adjustable input, it's just "recompute against the current
 * parse." */
export type DeadCodeState =
  | { status: 'loading' }
  | { status: 'loaded'; result: DeadCodeResponse }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

type DashboardTab = 'complexity' | 'hotspots' | 'dead-code'

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
  hotspots: HotspotsState | null
  onLoadHotspots: (windowDays: number) => void
  deadCode: DeadCodeState | null
  onLoadDeadCode: () => void
}

const MIN_LIST_WIDTH = 360
const MAX_LIST_WIDTH = 900
const MIN_GRAPH_WIDTH = 280
const DEFAULT_LIST_WIDTH = 520
const DEFAULT_HOTSPOT_WINDOW_DAYS = 90
const HOTSPOT_WINDOW_OPTIONS = [30, 90, 180]
const MAX_NEIGHBORHOOD_NODES = LARGE_GRAPH_NODE_THRESHOLD

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
  hotspots,
  onLoadHotspots,
  deadCode,
  onLoadDeadCode,
}: DashboardViewProps) {
  const compareDisabled = state.status !== 'loaded' || diff?.status === 'loading'
  const [listWidth, setListWidthState] = useState(() => clampListWidth(getDashboardSplitWidth() ?? DEFAULT_LIST_WIDTH))
  const [activeTab, setActiveTab] = useState<DashboardTab>('complexity')

  const handleSelectHotspotsTab = useCallback(() => {
    setActiveTab('hotspots')
    if (hotspots === null) onLoadHotspots(DEFAULT_HOTSPOT_WINDOW_DAYS)
  }, [hotspots, onLoadHotspots])

  const handleSelectDeadCodeTab = useCallback(() => {
    setActiveTab('dead-code')
    if (deadCode === null) onLoadDeadCode()
  }, [deadCode, onLoadDeadCode])

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

  // Scopes the relationship diagram to the *selected* function's direct
  // callers/callees only -- never the whole repo's call graph. Feeding
  // `MiniCallGraph` (and the dagre layout inside it, `graph/layout.ts`)
  // every scored function at once hung the browser outright on a
  // real-world repo the size of FastAPI: a single `.filter()` over
  // `graphEdges` here is cheap even at thousands of edges, but laying out
  // thousands of nodes is not. `MAX_NEIGHBORHOOD_NODES` reuses
  // `GraphCanvas`'s own large-graph threshold rather than inventing a new
  // number, guarding the one remaining pathological case: a single hub
  // function called from hundreds of places.
  const selectedNeighborhood = useMemo(() => {
    if (!selectedNodeId) {
      return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], truncated: false, totalCount: 0 }
    }
    const neighborEdges = graphEdges.filter(
      (edge) =>
        edge.kind === 'calls' && (edge.source === selectedNodeId || edge.target === selectedNodeId),
    )
    const neighborIds = new Set<string>([selectedNodeId])
    for (const edge of neighborEdges) {
      neighborIds.add(edge.source)
      neighborIds.add(edge.target)
    }
    const totalCount = neighborIds.size
    const truncated = totalCount > MAX_NEIGHBORHOOD_NODES
    const idList = [
      selectedNodeId,
      ...[...neighborIds].filter((id) => id !== selectedNodeId),
    ].slice(0, MAX_NEIGHBORHOOD_NODES)
    const idSet = new Set(idList)
    return {
      nodes: graphNodes.filter((node) => idSet.has(node.id)),
      edges: neighborEdges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target)),
      truncated,
      totalCount,
    }
  }, [selectedNodeId, graphNodes, graphEdges])

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
            Complexity, churn-weighted hotspots, and dead-code candidates — more signals land
            here as they ship.
          </div>
          <div style={{ display: 'flex', gap: spacing.xs, marginTop: 6 }}>
            <TabButton label="Complexity" active={activeTab === 'complexity'} onClick={() => setActiveTab('complexity')} />
            <TabButton label="Hotspots" active={activeTab === 'hotspots'} onClick={handleSelectHotspotsTab} />
            <TabButton label="Dead code" active={activeTab === 'dead-code'} onClick={handleSelectDeadCodeTab} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0, alignItems: 'center' }}>
          {activeTab === 'complexity' && (
            <>
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
            </>
          )}
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
          {activeTab === 'complexity' ? (
            <>
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
            </>
          ) : activeTab === 'hotspots' ? (
            <HotspotsPane hotspots={hotspots} onLoadHotspots={onLoadHotspots} onSelectNode={onSelectNode} />
          ) : (
            <DeadCodePane deadCode={deadCode} onSelectNode={onSelectNode} />
          )}
          <ResizeHandle width={listWidth} onResize={handleResizeListWidth} />
        </div>
        <div style={{ flex: 1, minWidth: MIN_GRAPH_WIDTH, borderLeft: `1px solid ${colors.bgPanel}`, display: 'flex', flexDirection: 'column' }}>
          {selectedNodeId ? (
            <>
              <MiniCallGraph
                nodes={selectedNeighborhood.nodes}
                edges={selectedNeighborhood.edges}
                scores={scores}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
              />
              {selectedNeighborhood.truncated && (
                <p style={{ color: colors.textMuted, fontSize: 11, padding: '4px 8px', margin: 0 }}>
                  Showing {MAX_NEIGHBORHOOD_NODES} of {selectedNeighborhood.totalCount} related functions.
                </p>
              )}
            </>
          ) : (
            <p style={{ color: colors.textMuted, fontSize: 12, padding: spacing.lg, margin: 0 }}>
              Select a function from the list to see its call relationships.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="sv-interactive"
      style={{
        background: active ? colors.bgPanel : 'transparent',
        border: `1px solid ${active ? colors.border : 'transparent'}`,
        borderRadius: 4,
        color: active ? colors.textPrimary : colors.textMuted,
        padding: '2px 8px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

const hotspotSelectStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

function HotspotsPane({
  hotspots,
  onLoadHotspots,
  onSelectNode,
}: {
  hotspots: HotspotsState | null
  onLoadHotspots: (windowDays: number) => void
  onSelectNode: (nodeId: string) => void
}) {
  const windowDays = hotspots?.windowDays ?? DEFAULT_HOTSPOT_WINDOW_DAYS

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
        <label htmlFor="sv-hotspot-window" style={{ fontSize: 12, color: colors.textMuted }}>
          Window
        </label>
        <select
          id="sv-hotspot-window"
          value={windowDays}
          onChange={(event) => onLoadHotspots(Number(event.target.value))}
          style={hotspotSelectStyle}
        >
          {HOTSPOT_WINDOW_OPTIONS.map((days) => (
            <option key={days} value={days}>
              Last {days} days
            </option>
          ))}
        </select>
      </div>
      {hotspots === null || hotspots.status === 'loading' ? (
        <p style={{ color: colors.textMuted }}>Loading…</p>
      ) : hotspots.status === 'error' ? (
        <p role="alert" style={{ color: colors.danger }}>
          {hotspots.message}
        </p>
      ) : !hotspots.result.is_git_repo ? (
        <p style={{ color: colors.textMuted }}>
          Not a git repository — hotspot ranking needs git history to compute churn.
        </p>
      ) : (
        <HotspotReportPane scores={hotspots.result.scores} onSelectNode={onSelectNode} />
      )}
    </>
  )
}

function DeadCodePane({
  deadCode,
  onSelectNode,
}: {
  deadCode: DeadCodeState | null
  onSelectNode: (nodeId: string) => void
}) {
  if (deadCode === null || deadCode.status === 'loading') {
    return <p style={{ color: colors.textMuted }}>Loading…</p>
  }
  if (deadCode.status === 'error') {
    return (
      <p role="alert" style={{ color: colors.danger }}>
        {deadCode.message}
      </p>
    )
  }
  if (deadCode.status === 'unavailable') {
    return <p style={{ color: colors.textMuted }}>{deadCode.message}</p>
  }
  return <DeadCodeReportPane candidates={deadCode.result.candidates} onSelectNode={onSelectNode} />
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
