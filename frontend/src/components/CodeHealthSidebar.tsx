import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { GraphNode } from '../api/types'
import { colors, radius, spacing } from '../theme'
import {
  getDashboardSplitWidth,
  getDependencyScanConsent,
  setDashboardSplitWidth,
  setDependencyScanConsent,
} from '../utils/localStorage'
import type {
  CoverageIngestState,
  CoverageState,
  DashboardState,
  DeadCodeState,
  DependencyRiskState,
  DuplicatesState,
  HealthTab,
  HotspotsState,
} from './codeHealthTypes'
import { CoverageReportPane } from './CoverageReportPane'
import { DeadCodeReportPane } from './DeadCodeReportPane'
import { DependencyRiskReportPane } from './DependencyRiskReportPane'
import { DuplicatesReportPane } from './DuplicatesReportPane'
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

/** A shimmering stand-in for a `RankedFunctionRow` while the dashboard's
 * initial fetch (or the Hotspots/Dead code tab's own lazy fetch) is still
 * in flight -- that computation genuinely takes a few seconds on a real
 * repo (a full AST walk, or a git-churn pass over every file), and a bare
 * "Loading…" line on an otherwise-empty column read as frozen rather than
 * working. `count` rows, not the real (still-unknown) result size, so the
 * skeleton's own height is exactly what a real list would need to fill --
 * matches `RankedFunctionRow`'s box dimensions (`radius.md`/`bgPanel`/
 * `border`) so it reads as "this list, not yet in" rather than a generic
 * unrelated spinner. */
function SkeletonRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="sv-skeleton"
          style={{
            height: 52,
            marginBottom: spacing.xs,
            borderRadius: radius.md,
            border: `1px solid ${colors.border}`,
            // Each row's shimmer sweep starts a little later than the one
            // above it -- a uniform wave down the list reads as "actively
            // working," a flat synchronized pulse reads as a broken CSS
            // animation.
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </div>
  )
}

/** Loading copy + spinner + skeleton rows, shared by all three tabs'
 * "still fetching" states -- the specific wording differs per tab (each
 * fetch does genuinely different, differently-slow work), the visual
 * treatment doesn't. */
function LoadingNotice({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <p
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          margin: `0 0 ${spacing.md}px`,
          color: colors.textMuted,
          fontSize: 12,
        }}
      >
        <span className="spinner" aria-hidden="true" />
        {message}
      </p>
      <SkeletonRows count={8} />
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
        <LoadingNotice message="Computing churn history for every file…" />
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

const ingestInputStyle = {
  flex: 1,
  minWidth: 0,
  padding: '5px 8px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.border}`,
  background: colors.bgPage,
  color: colors.textPrimary,
  fontSize: 12,
} as const

function CoveragePane({
  coverage,
  coverageIngest,
  graphNodes,
  selectedNodeId,
  onIngestCoverage,
  onSelectNode,
}: {
  coverage: CoverageState | null
  coverageIngest: CoverageIngestState
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onIngestCoverage: (coveragePath: string) => void
  onSelectNode: (nodeId: string) => void
}) {
  const [coveragePath, setCoveragePath] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = coveragePath.trim()
    if (!trimmed) return
    onIngestCoverage(trimmed)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <form onSubmit={handleSubmit} style={{ marginBottom: spacing.md }}>
        <label
          htmlFor="sv-coverage-path"
          style={{ display: 'block', fontSize: 12, marginBottom: spacing.xs, color: colors.textMuted }}
        >
          Coverage report path (coverage.py XML or lcov)
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="sv-coverage-path"
            type="text"
            value={coveragePath}
            onChange={(event) => setCoveragePath(event.target.value)}
            placeholder="/repo/coverage.xml"
            aria-label="Coverage report path"
            title="Path to a coverage.py XML (`coverage xml`) or lcov report your own test-runner already produced"
            style={ingestInputStyle}
          />
          <button
            type="submit"
            disabled={coverageIngest.status === 'submitting' || coveragePath.trim().length === 0}
            className="sv-interactive"
            style={{
              padding: '5px 10px',
              borderRadius: radius.sm,
              border: 'none',
              background: coverageIngest.status === 'submitting' ? colors.disabled : colors.accent,
              color: colors.textPrimary,
              fontSize: 12,
              cursor: coverageIngest.status === 'submitting' ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            {coverageIngest.status === 'submitting' ? 'Ingesting…' : 'Ingest'}
          </button>
        </div>
        {coverageIngest.status === 'success' &&
          (coverageIngest.result.files_matched === 0 && coverageIngest.result.files_in_report > 0 ? (
            // `files_matched === 0` alongside a non-zero `files_in_report` means the
            // report parsed fine but none of its paths line up with this repo's own
            // (e.g. generated from a different working directory) -- every function
            // will read "No coverage data," not a bug, so this needs to read as a
            // warning to check the report's paths, not as a plain success line.
            <p
              role="alert"
              style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.warningText }}
            >
              0 of {coverageIngest.result.files_in_report} report file
              {coverageIngest.result.files_in_report === 1 ? '' : 's'} matched this repo's parsed
              paths — every function will show "No coverage data." Check the report was generated
              from this same root.
            </p>
          ) : (
            <p
              role="status"
              style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.success }}
            >
              {coverageIngest.result.files_matched} of {coverageIngest.result.files_in_report}{' '}
              report file{coverageIngest.result.files_in_report === 1 ? '' : 's'} matched —{' '}
              {coverageIngest.result.lines_recorded} line
              {coverageIngest.result.lines_recorded === 1 ? '' : 's'} recorded.
            </p>
          ))}
        {coverageIngest.status === 'error' && (
          <p role="alert" style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.danger }}>
            {coverageIngest.message}
          </p>
        )}
      </form>

      {coverage === null || coverage.status === 'loading' ? (
        <LoadingNotice message="Computing coverage risk ranking…" />
      ) : coverage.status === 'error' ? (
        <p role="alert" style={{ color: colors.danger }}>
          {coverage.message}
        </p>
      ) : coverage.status === 'unavailable' ? (
        <EmptyStateNotice message={coverage.message} />
      ) : !coverage.result.available ? (
        <EmptyStateNotice message="No coverage report ingested yet — enter a path above and click Ingest to rank functions by correctness risk." />
      ) : (
        <CoverageReportPane
          scores={coverage.result.scores}
          graphNodes={graphNodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      )}
    </div>
  )
}

function DependenciesPane({
  dependencyRisk,
  onScanDependencies,
}: {
  dependencyRisk: DependencyRiskState
  onScanDependencies: () => void
}) {
  const [consentChecked, setConsentChecked] = useState(() => getDependencyScanConsent())

  function handleScanClick() {
    setDependencyScanConsent()
    onScanDependencies()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Cross-references packages this repo's code actually imports against what's declared in
        its manifest, then queries osv.dev for known vulnerabilities — the one feature in this
        app that makes a live outbound network call.
      </p>
      {dependencyRisk.status === 'idle' || dependencyRisk.status === 'error' ? (
        // A bordered card, not bare controls floating in the column --
        // every other tab's own "nothing to show yet" state (EmptyStateNotice)
        // has real visual weight; this opt-in tab's own idle state should too,
        // rather than reading as unfinished next to its siblings.
        <div
          style={{
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            padding: spacing.lg,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.xs,
              fontSize: 12,
              color: colors.textMuted,
              marginBottom: spacing.sm,
            }}
          >
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(event) => setConsentChecked(event.target.checked)}
            />
            I understand this queries osv.dev over the network
          </label>
          <button
            type="button"
            disabled={!consentChecked}
            onClick={handleScanClick}
            className="sv-interactive"
            style={{
              padding: '6px 12px',
              borderRadius: radius.sm,
              border: 'none',
              background: consentChecked ? colors.accent : colors.disabled,
              color: colors.textPrimary,
              fontSize: 12,
              cursor: consentChecked ? 'pointer' : 'default',
            }}
          >
            Scan dependencies
          </button>
          {dependencyRisk.status === 'error' && (
            <p role="alert" style={{ marginTop: spacing.sm, color: colors.danger }}>
              {dependencyRisk.message}
            </p>
          )}
        </div>
      ) : dependencyRisk.status === 'submitting' ? (
        <LoadingNotice message="Querying osv.dev for known vulnerabilities…" />
      ) : dependencyRisk.status === 'unavailable' ? (
        <EmptyStateNotice message={dependencyRisk.message} />
      ) : !dependencyRisk.result.available ? (
        <EmptyStateNotice
          message={dependencyRisk.result.message ?? 'Could not reach osv.dev — try again.'}
        />
      ) : (
        <DependencyRiskReportPane risks={dependencyRisk.result.risks} />
      )}
    </div>
  )
}

interface CodeHealthSidebarProps {
  healthTab: HealthTab
  onHealthTabChange: (tab: HealthTab) => void
  state: DashboardState
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  hotspots: HotspotsState | null
  onLoadHotspots: (windowDays: number) => void
  deadCode: DeadCodeState | null
  onLoadDeadCode: () => void
  coverage: CoverageState | null
  onLoadCoverage: () => void
  coverageIngest: CoverageIngestState
  onIngestCoverage: (coveragePath: string) => void
  duplicates: DuplicatesState | null
  onLoadDuplicates: () => void
  dependencyRisk: DependencyRiskState
  onScanDependencies: () => void
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
  graphNodes,
  selectedNodeId,
  onSelectNode,
  hotspots,
  onLoadHotspots,
  deadCode,
  onLoadDeadCode,
  coverage,
  onLoadCoverage,
  coverageIngest,
  onIngestCoverage,
  duplicates,
  onLoadDuplicates,
  dependencyRisk,
  onScanDependencies,
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

  const handleSelectCoverageTab = useCallback(() => {
    onHealthTabChange('coverage')
    if (coverage === null) onLoadCoverage()
  }, [coverage, onLoadCoverage, onHealthTabChange])

  const handleSelectDuplicatesTab = useCallback(() => {
    onHealthTabChange('duplicates')
    if (duplicates === null) onLoadDuplicates()
  }, [duplicates, onLoadDuplicates, onHealthTabChange])

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
        {/* `flexWrap: 'wrap'` -- six tabs (up from the original three) no
            longer reliably fit on one line at `MIN_LIST_WIDTH` (360px, the
            floor the resize handle itself can reach); wrapping onto a
            second line keeps every tab inside the sidebar's own bounds
            instead of overflowing out over the main content pane, and
            degrades gracefully for however many tabs this lens grows to
            next, rather than needing `MIN_LIST_WIDTH` re-tuned per addition. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
          <TabButton label="Complexity" active={healthTab === 'complexity'} onClick={() => onHealthTabChange('complexity')} />
          <TabButton label="Hotspots" active={healthTab === 'hotspots'} onClick={handleSelectHotspotsTab} />
          <TabButton label="Dead code" active={healthTab === 'dead-code'} onClick={handleSelectDeadCodeTab} />
          <TabButton label="Coverage" active={healthTab === 'coverage'} onClick={handleSelectCoverageTab} />
          <TabButton label="Duplicates" active={healthTab === 'duplicates'} onClick={handleSelectDuplicatesTab} />
          {/* No lazy-fetch wrapper handler needed, unlike every other tab
              here -- this is the one opt-in, network-calling feature, so
              opening the tab itself must never trigger a fetch; the scan
              only starts from `DependenciesPane`'s own explicit button. */}
          <TabButton
            label="Dependencies"
            active={healthTab === 'dependencies'}
            onClick={() => onHealthTabChange('dependencies')}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: spacing.lg }}>
        {healthTab === 'complexity' ? (
          <>
            {state.status === 'loading' && (
              <LoadingNotice message="Analyzing complexity across the codebase…" />
            )}
            {state.status === 'error' && (
              <p role="alert" style={{ color: colors.danger }}>
                {state.message}
              </p>
            )}
            {state.status === 'loaded' && (
              <PerformanceReportPane
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
        ) : healthTab === 'dead-code' ? (
          <DeadCodePane deadCode={deadCode} graphNodes={graphNodes} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : healthTab === 'coverage' ? (
          <CoveragePane
            coverage={coverage}
            coverageIngest={coverageIngest}
            graphNodes={graphNodes}
            selectedNodeId={selectedNodeId}
            onIngestCoverage={onIngestCoverage}
            onSelectNode={onSelectNode}
          />
        ) : healthTab === 'duplicates' ? (
          <DuplicatesPane
            duplicates={duplicates}
            graphNodes={graphNodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
          />
        ) : (
          <DependenciesPane dependencyRisk={dependencyRisk} onScanDependencies={onScanDependencies} />
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
    return <LoadingNotice message="Scanning for functions with no callers…" />
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

function DuplicatesPane({
  duplicates,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: {
  duplicates: DuplicatesState | null
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}) {
  if (duplicates === null || duplicates.status === 'loading') {
    return <LoadingNotice message="Comparing every function's structure for exact-shape matches…" />
  }
  if (duplicates.status === 'error') {
    return (
      <p role="alert" style={{ color: colors.danger }}>
        {duplicates.message}
      </p>
    )
  }
  return (
    <DuplicatesReportPane
      groups={duplicates.result.groups}
      graphNodes={graphNodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
    />
  )
}
