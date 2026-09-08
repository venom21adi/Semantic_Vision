import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { GraphNode } from '../api/types'
import { colors, radius, spacing } from '../theme'
import { getDashboardSplitWidth, setDashboardSplitWidth } from '../utils/localStorage'
import type { DashboardState, DeadCodeState, HealthTab, HotspotsState } from './codeHealthTypes'
import { DeadCodeReportPane } from './DeadCodeReportPane'
import { HotspotReportPane } from './HotspotReportPane'
import { PerformanceReportPane } from './PerformanceReportPane'

const MIN_LIST_WIDTH = 360
const MAX_LIST_WIDTH = 900
const MIN_MAIN_WIDTH = 280
const DEFAULT_LIST_WIDTH = 520
const DEFAULT_HOTSPOT_WINDOW_DAYS = 90
const HOTSPOT_WINDOW_OPTIONS = [30, 90, 180]

function clampListWidth(width: number): number {
  const viewportMax = typeof window === 'undefined' ? MAX_LIST_WIDTH : window.innerWidth - MIN_MAIN_WIDTH
  return Math.min(Math.max(width, MIN_LIST_WIDTH), Math.min(MAX_LIST_WIDTH, viewportMax))
}

/** A drag handle on this column's right edge -- mirrors `DetailsPanel.tsx`'s
 * `ResizeHandle` (pointermove drag, arrow-key step, clamped width, debounced
 * persistence owned by the caller) for visual/interaction consistency with
 * the app's other resizable panes, rather than a new one-off implementation. */
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
      aria-label="Resize Code Health list"
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

/** A centered, slightly-styled stand-in for "there's nothing to rank here"
 * states (not a git repo, dead-code detection unavailable in this build)
 * -- these used to be a single line of dim text pinned to the top-left of
 * an otherwise empty column, which read as broken rather than as an
 * intentional, informative state. Deliberately not used for transient
 * loading text or `role="alert"` errors, which stay as plain inline
 * messages elsewhere in this file. */
function EmptyStateNotice({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: spacing.sm,
        padding: `${spacing.xxxl}px ${spacing.lg}px`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      />
      <p style={{ margin: 0, fontSize: 12, color: colors.textMuted, maxWidth: 260, lineHeight: 1.5 }}>
        {message}
      </p>
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
        borderRadius: radius.sm,
        color: active ? colors.textPrimary : colors.textMuted,
        padding: '3px 9px',
        fontSize: 12,
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
  graphNodes,
  selectedNodeId,
  onLoadHotspots,
  onSelectNode,
}: {
  hotspots: HotspotsState | null
  graphNodes: GraphNode[]
  selectedNodeId: string | null
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
        <EmptyStateNotice message="Not a git repository — hotspot ranking needs git history to compute churn." />
      ) : (
        <HotspotReportPane
          scores={hotspots.result.scores}
          graphNodes={graphNodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      )}
    </>
  )
}

interface CodeHealthSidebarProps {
  healthTab: HealthTab
  onHealthTabChange: (tab: HealthTab) => void
  state: DashboardState
  path: string
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  hotspots: HotspotsState | null
  onLoadHotspots: (windowDays: number) => void
  deadCode: DeadCodeState | null
  onLoadDeadCode: () => void
}

/** The Code Health lens's left column -- occupies exactly the position
 * `Sidebar.tsx` does in the Codebase Graph lens (see `App.tsx`'s lens
 * switch), so the two lenses read as peers rather than one dumping a
 * second, redundant navigator next to the graph's own tree. Tab row picks
 * which dataset populates the ranked list below it; `CodeHealthDetail.tsx`
 * (the main-content column) reads the same `healthTab` to decide whether
 * to show the diff/summary controls that only make sense for Complexity. */
export function CodeHealthSidebar({
  healthTab,
  onHealthTabChange,
  state,
  path,
  graphNodes,
  selectedNodeId,
  onSelectNode,
  hotspots,
  onLoadHotspots,
  deadCode,
  onLoadDeadCode,
}: CodeHealthSidebarProps) {
  const [listWidth, setListWidthState] = useState(() =>
    clampListWidth(getDashboardSplitWidth() ?? DEFAULT_LIST_WIDTH),
  )

  const handleSelectHotspotsTab = useCallback(() => {
    onHealthTabChange('hotspots')
    if (hotspots === null) onLoadHotspots(DEFAULT_HOTSPOT_WINDOW_DAYS)
  }, [hotspots, onLoadHotspots, onHealthTabChange])

  const handleSelectDeadCodeTab = useCallback(() => {
    onHealthTabChange('dead-code')
    if (deadCode === null) onLoadDeadCode()
  }, [deadCode, onLoadDeadCode, onHealthTabChange])

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

  return (
    <aside
      style={{
        position: 'relative',
        width: listWidth,
        flexShrink: 0,
        borderRight: `1px solid ${colors.bgPanel}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ padding: `${spacing.sm}px ${spacing.sm}px 0` }}>
        <div style={{ display: 'flex', gap: spacing.xs }}>
          <TabButton label="Complexity" active={healthTab === 'complexity'} onClick={() => onHealthTabChange('complexity')} />
          <TabButton label="Hotspots" active={healthTab === 'hotspots'} onClick={handleSelectHotspotsTab} />
          <TabButton label="Dead code" active={healthTab === 'dead-code'} onClick={handleSelectDeadCodeTab} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: spacing.lg }}>
        {healthTab === 'complexity' ? (
          <>
            {state.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
            {state.status === 'error' && (
              <p role="alert" style={{ color: colors.danger }}>
                {state.message}
              </p>
            )}
            {state.status === 'loaded' && (
              <PerformanceReportPane
                path={path}
                scores={state.scores}
                graphNodes={graphNodes}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
              />
            )}
          </>
        ) : healthTab === 'hotspots' ? (
          <HotspotsPane
            hotspots={hotspots}
            graphNodes={graphNodes}
            selectedNodeId={selectedNodeId}
            onLoadHotspots={onLoadHotspots}
            onSelectNode={onSelectNode}
          />
        ) : (
          <DeadCodePane deadCode={deadCode} graphNodes={graphNodes} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        )}
      </div>
      <ResizeHandle width={listWidth} onResize={handleResizeListWidth} />
    </aside>
  )
}

function DeadCodePane({
  deadCode,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: {
  deadCode: DeadCodeState | null
  graphNodes: GraphNode[]
  selectedNodeId: string | null
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
    return <EmptyStateNotice message={deadCode.message} />
  }
  return (
    <DeadCodeReportPane
      candidates={deadCode.result.candidates}
      graphNodes={graphNodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
    />
  )
}
