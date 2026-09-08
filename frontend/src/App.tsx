import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  DeadCodeUnavailableError,
  DEMO_MODE,
  getComplexity,
  getComplexityDiff,
  getComplexityDiffRef,
  getComplexityHotspots,
  getDeadCode,
  getDefaultVisibleIds,
  getDoc,
  getFlowchart,
  getFunctionSource,
  getGitRefs,
  getGraph,
  getGraphState,
  getImpact,
  getImpactShowcaseIds,
  getOllamaModels,
  parseRepo,
  saveDoc,
  saveGraphState,
  streamDoc,
  updateDocRoot,
} from './api/client'
import type {
  DocProvider,
  FlowchartResponse,
  GraphEdge,
  GraphNode,
  NodePosition,
  ParseErrorInfo,
} from './api/types'
import { CodeHealthDetail } from './components/CodeHealthDetail'
import { CodeHealthSidebar } from './components/CodeHealthSidebar'
import {
  type DashboardState,
  type DeadCodeState,
  type DiffMode,
  type DiffState,
  type HealthTab,
  type HotspotsState,
} from './components/codeHealthTypes'
import type { GitRefsState } from './components/RefPicker'
import { DetailsPanel, type ActivePane } from './components/DetailsPanel'
import { DemoRepoPicker } from './components/DemoRepoPicker'
import { DemoRepoPill } from './components/DemoRepoPill'
import { RepoLoader } from './components/RepoLoader'
import { RepoPill } from './components/RepoPill'
import { Sidebar, type GraphView } from './components/Sidebar'
import { FlowchartCanvas } from './flowchart/FlowchartCanvas'
import { buildFlowchartGraph } from './flowchart/transform'
import { formatNodeLabel } from './graph/accessorLabel'
import {
  buildVisibleGraph,
  collapseToOutermost,
  directChildIds,
  subtreeIds,
} from './graph/collapseDirectories'
import { GraphCanvas, LARGE_GRAPH_NODE_THRESHOLD, type GraphHighlight } from './graph/GraphCanvas'
import { scopeToFile } from './graph/transform'
import { resolveNodeOverlaps } from './graph/layout'
import { useLayoutWorker } from './graph/useLayoutWorker'
import { colors, font, radius, spacing } from './theme'
import { LogoMark } from './components/Logo'
import { HelpGuide } from './components/HelpGuide'
import { rootNodeIds } from './tree/buildTree'
import {
  dismissDocSaveNotice,
  getDetailsCollapsed,
  getDetailsWidth,
  getLastRepoPath,
  getRememberedDocRoot,
  getRememberedLanguage,
  getSidebarCollapsed,
  isDocSaveNoticeDismissed,
  setDetailsCollapsed,
  setDetailsWidth,
  setLastRepoPath,
  setRememberedDocRoot,
  setRememberedLanguage,
  setSidebarCollapsed,
} from './utils/localStorage'

const EMPTY_GRAPH: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] }

/** Edge kinds that connect code to data or data to data -- everything the
 * "Data only" sidebar filter treats as in-scope. Kept as a standalone
 * constant (rather than inlined into the memo below) since it doubles as
 * the definition of "what counts as data lineage" on this canvas. */
const DATA_LINEAGE_EDGE_KINDS: ReadonlySet<GraphEdge['kind']> = new Set([
  'maps_to',
  'foreign_key',
  'references',
  'materializes',
  'reads',
  'writes',
])

/** A container's canvas chevron expands it directly only when it has at
 * most this many immediate children -- above it, expanding would dump
 * more boxes onto the canvas in one click than are reasonably readable
 * at once (confirmed live: a 78-child directory produced a single wide
 * row that stayed mostly off-screen even at the zoom floor). Past this,
 * the user is routed to the sidebar's checkboxes to pick specific
 * children instead. Deliberately larger than the sidebar tree's own
 * `DEFAULT_COLLAPSE_CHILD_THRESHOLD` (5) -- a compact text row and a
 * full canvas box are very different amounts of screen space. */
const EXPAND_CHILD_THRESHOLD = 12

/** How long `debouncedVisibleIds` (below) waits after the *last* `visibleIds`
 * change before applying it. Milestone 18 (`docs/PHASE-2-BUILD-PLAN.md`)
 * profiled a rapid burst of canvas checkbox clicks (e.g. many "show on
 * canvas" boxes checked in a row) and found each one forced its own full,
 * separate `buildVisibleGraph`/layout/render pass -- the checkbox itself
 * isn't the expensive part, but everything downstream of `visibleIds`
 * changing is. 150ms comfortably coalesces a rapid burst into one pass
 * while staying low enough that a single click's own resulting graph
 * update -- already not instant today, since it waits on the layout worker
 * regardless -- doesn't read as newly sluggish. */
export const VISIBLE_IDS_SETTLE_MS = 150

/** Settles to `value` only after `delayMs` of no further changes. The
 * checkbox's own visual checked state must stay on the un-debounced
 * `visibleIds` directly (native checkboxes should never lag a click) --
 * only the expensive downstream consumer (`collapsedCodebaseGraph` below)
 * reads the debounced value. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

interface LoadedRepo {
  path: string
  docRoot: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeCount: number
  edgeCount: number
  parseErrors: ParseErrorInfo[]
  positions: Record<string, NodePosition>
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

/** The header's "Codebase Graph" / "Code Health" lens switcher -- styled
 * like `Sidebar.tsx`'s existing Codebase/File view toggle (same active/
 * inactive treatment) rather than a new button style, so the two peer
 * navigation controls in this app read as the same family. */
function LensTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="sv-interactive"
      style={{
        padding: `${spacing.xs}px ${spacing.md}px`,
        borderRadius: radius.sm,
        border: `1px solid ${colors.border}`,
        background: active ? colors.accent : 'transparent',
        color: colors.textPrimary,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

type FlowchartState =
  | { status: 'loading'; label: string }
  | { status: 'loaded'; label: string; data: FlowchartResponse }
  | { status: 'error'; label: string; message: string }

interface VsCodeApi {
  postMessage: (message: unknown) => void
}

declare global {
  interface Window {
    __SEMANTIC_VISION_VSCODE__?: boolean
  }
  function acquireVsCodeApi(): VsCodeApi
}

// `acquireVsCodeApi()` may only be called once per webview session (it
// throws on a second call) -- resolved once at module scope, not inside
// the component, so remounts/Fast Refresh during dev never call it twice.
// Undefined for every load outside the VS Code extension's webview (a
// plain browser tab, the Vite dev server, tests), which is what every
// `vscodeApi &&`/`if (vscodeApi)` branch below relies on to stay inert
// there.
const vscodeApi: VsCodeApi | null =
  typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null

/** Messages the extension host posts into this webview -- mirrors
 * `vscode-extension/src/extension.ts`'s `postMessage` calls. */
type HostMessage =
  | { command: 'activeFileChanged'; file: string }
  | { command: 'runImpactAnalysis'; nodeId: string }

export default function App() {
  const [repo, setRepo] = useState<LoadedRepo | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [pane, setPane] = useState<ActivePane>(null)
  const [view, setView] = useState<GraphView>('codebase')
  const [docProvider, setDocProvider] = useState<DocProvider>('ollama')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false)
  const [ollamaModel, setOllamaModel] = useState('')
  const [docSaveNoticeDismissed, setDocSaveNoticeDismissed] = useState(() =>
    isDocSaveNoticeDismissed(),
  )
  const [flowchartState, setFlowchartState] = useState<FlowchartState | null>(null)
  // Which of the two peer lenses on this repo is showing -- 'graph' (the
  // canvas + DetailsPanel, `Sidebar`'s tree) or 'health' (the Code Health
  // dashboard, `CodeHealthSidebar`'s ranked list + `CodeHealthDetail`).
  // Switched via the header tabs (see the JSX below), not toggled open/
  // closed -- each lens's own state (`dashboard`/`hotspots`/`deadCode`
  // below, or `visibleIds`/`pane` for the graph) survives a switch away
  // and back, the way a browser tab's state survives switching tabs.
  const [lens, setLens] = useState<'graph' | 'health'>('graph')
  // Which dataset populates the Code Health lens's list -- lifted here
  // (rather than living inside `CodeHealthSidebar`) because
  // `CodeHealthSidebar` (the list) and `CodeHealthDetail` (summary/diff/
  // relationship graph) render in two different places in the JSX below,
  // not as parent/child, and both need to agree on it.
  const [healthTab, setHealthTab] = useState<HealthTab>('complexity')
  // The Code Health lens's complexity scores -- fetched once when the lens
  // first activates (see handleActivateHealthLens below), reused on every
  // later switch back to this lens rather than refetched.
  const [dashboard, setDashboard] = useState<DashboardState | null>(null)
  // The Code Health lens's "Compare to last look" result -- a sibling to
  // `dashboard`, not nested inside it, matching this file's convention of
  // flat, independently managed state slices rather than one growing
  // mega-object. See `handleCompareDashboard` and `resetHealthState`.
  const [dashboardDiff, setDashboardDiff] = useState<DiffState | null>(null)
  // Branches + recent commits for the "compare to commit" ref picker --
  // fetched once when the Code Health lens activates, alongside the
  // scores fetch, and cleared by the same `resetHealthState` chokepoint.
  const [gitRefs, setGitRefs] = useState<GitRefsState | null>(null)
  // The Code Health lens's Hotspots tab -- unlike `dashboard`/`gitRefs`,
  // fetched lazily (see `handleLoadHotspots`/`CodeHealthSidebar`'s own
  // `handleSelectHotspotsTab`) the first time that tab is opened, not eagerly
  // alongside the rest of the lens's data. Still a flat sibling state slice,
  // still cleared by `resetHealthState` -- the exact chokepoint this lens's
  // own `DiffMode` comment already warns future additions to wire into.
  const [hotspots, setHotspots] = useState<HotspotsState | null>(null)
  // The Code Health lens's Dead Code tab -- same lazy-fetch-on-first-open
  // treatment as `hotspots` above (see `handleLoadDeadCode`/
  // `CodeHealthSidebar`'s own `handleSelectDeadCodeTab`), same flat sibling
  // state slice cleared by `resetHealthState`.
  const [deadCode, setDeadCode] = useState<DeadCodeState | null>(null)
  // The single source of truth for the codebase-view canvas: exactly the
  // ids that render as their own box (see `buildVisibleGraph`). The
  // sidebar's checkboxes and the canvas chevron both just toggle
  // membership in this one set -- there's no separate "selected" vs
  // "expanded" concept anymore, which is what makes checking/unchecking
  // any item, at any depth, always affect the canvas (previously, a
  // child's checkbox did nothing once an ancestor directory was already
  // selected, since the old two-set model could only add a whole subtree,
  // never toggle one specific descendant within it). The canvas starts
  // empty for a repo above the large-graph threshold (see handleLoad)
  // rather than auto-populating with every top-level node; a repo at or
  // below it still starts fully expanded, matching this app's original
  // zero-click behavior.
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(new Set())
  // Populated on load, demo mode only (see handleLoad) -- curated function
  // ids worth suggesting to a first-time visitor, since a function picked
  // at random is as likely as not to have zero callers in a small demo
  // repo. Empty (and unused) in the real app.
  const [showcaseIds, setShowcaseIds] = useState<string[]>([])
  // Set when the canvas chevron is clicked on a container with more
  // direct children than `EXPAND_CHILD_THRESHOLD` -- expanding it right
  // there would dump all of them onto the canvas at once (confirmed live
  // against a real large repo: a single 78-child directory turned the
  // canvas into one useless wide row that not even "fit view" could
  // usefully zoom out to). Cleared automatically after a few seconds, or
  // immediately by any other visibility-changing action.
  const [expandBlockedNotice, setExpandBlockedNotice] = useState<{ label: string; count: number } | null>(
    null,
  )
  // Kinds hidden via the canvas's edge-kind legend -- a pure display
  // filter (see GraphCanvas's `displayEdges`), never fed back into
  // layout, so toggling one never moves a node. Empty by default: every
  // kind visible, identical to this app's behavior before the legend
  // existed. Deliberately *not* reset on a view/repo switch (GraphCanvas
  // itself remounts via its `key` below, but this state lives here, in
  // App) -- hiding e.g. `imports` is a standing preference for how you
  // want to read a graph, not a per-view setting, so it should carry
  // over to the next view/repo the same way `sidebarCollapsed` does.
  const [hiddenEdgeKinds, setHiddenEdgeKinds] = useState<ReadonlySet<GraphEdge['kind']>>(new Set())
  // The sidebar's "Data only" lens -- dims (never removes) every node/edge
  // outside `dataLineageHighlight` below. A plain toggle, independent of
  // `pane`, since it's a display filter over whatever's already on the
  // canvas rather than a fetched analysis result.
  const [dataOnlyActive, setDataOnlyActive] = useState(false)
  const handleToggleDataOnly = useCallback(() => {
    setDataOnlyActive((prev) => !prev)
  }, [])
  const handleToggleEdgeKind = useCallback((kind: GraphEdge['kind']) => {
    setHiddenEdgeKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => getSidebarCollapsed())
  const [detailsCollapsed, setDetailsCollapsedState] = useState(() => getDetailsCollapsed())
  const [detailsWidth, setDetailsWidthState] = useState(() => getDetailsWidth() ?? 320)

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsedState((prev) => {
      const next = !prev
      setSidebarCollapsed(next)
      return next
    })
  }, [])

  const toggleDetailsCollapsed = useCallback(() => {
    setDetailsCollapsedState((prev) => {
      const next = !prev
      setDetailsCollapsed(next)
      return next
    })
  }, [])

  // Fired on every `pointermove` while dragging (see `DetailsPanel.tsx`'s
  // `ResizeHandle`) -- cheap, just a state update, so the panel visually
  // tracks the cursor with no lag. The `localStorage` write is debounced
  // separately below (`debouncedDetailsWidth`), the same
  // settle-before-persisting treatment `visibleIds` already gets, so a
  // drag's rapid-fire moves don't turn into one write per pixel.
  const handleResizeDetailsWidth = useCallback((width: number) => {
    setDetailsWidthState(width)
  }, [])
  const debouncedDetailsWidth = useDebouncedValue(detailsWidth, 300)
  useEffect(() => {
    setDetailsWidth(debouncedDetailsWidth)
  }, [debouncedDetailsWidth])

  const repoRef = useRef(repo)
  useEffect(() => {
    repoRef.current = repo
  }, [repo])

  const paneRef = useRef(pane)
  useEffect(() => {
    paneRef.current = pane
  }, [pane])

  // Identifies *which* `getComplexity` request (from handleActivateHealthLens) a
  // response belongs to -- stronger than checking a mirrored `dashboard` ref's
  // `status === 'loading'` alone would be (that only proves *some* request is
  // in flight, not that it's this one). Without it, a fresh repo load
  // invalidating this while a fetch is still in flight would let a
  // status-only guard accept whichever resolves last even if it's stale.
  const dashboardRequestIdRef = useRef(0)
  // Same guard, for `handleCompareDashboard`'s `getComplexityDiff` request --
  // independent of `dashboardRequestIdRef` since a compare can be in flight
  // (or invalidated) on its own, without the dashboard's own initial fetch
  // being re-triggered.
  const dashboardDiffRequestIdRef = useRef(0)
  // Same guard, for `handleLoadHotspots`'s `getComplexityHotspots` request --
  // independent of the other two since the Hotspots tab fetches lazily and
  // on its own schedule (first open, then again on every window-size change),
  // not tied to the dashboard's initial load or a complexity compare.
  const hotspotsRequestIdRef = useRef(0)
  // Same guard, for `handleLoadDeadCode`'s `getDeadCode` request --
  // independent of the others for the same reason `hotspotsRequestIdRef` is.
  const deadCodeRequestIdRef = useRef(0)

  // The single chokepoint for invalidating the Code Health lens's data --
  // called only when a fresh repo load makes the previous scores stale
  // (see handleLoad below). Always bumps *all four* request-id refs and
  // clears `dashboardDiff`/`hotspots`/`deadCode` too, or a fetch still in
  // flight (the dashboard's own, a compare's, a hotspots load, or a
  // dead-code load) when this fires could resolve afterwards and
  // resurrect state that no longer belongs to the newly-loaded repo.
  const resetHealthState = useCallback(() => {
    dashboardRequestIdRef.current += 1
    dashboardDiffRequestIdRef.current += 1
    hotspotsRequestIdRef.current += 1
    deadCodeRequestIdRef.current += 1
    setDashboard(null)
    setDashboardDiff(null)
    setGitRefs(null)
    setHotspots(null)
    setDeadCode(null)
  }, [])

  useEffect(() => {
    if (!expandBlockedNotice) return
    const timer = setTimeout(() => setExpandBlockedNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [expandBlockedNotice])

  // Tracks the in-flight doc-generation request (if any) so navigating
  // away mid-stream -- selecting a different node, closing the pane, or
  // starting a fresh generation -- can cancel it instead of leaving a
  // dangling fetch that keeps calling `setPane` for a pane the user has
  // already left.
  const generationRef = useRef<AbortController | null>(null)
  const cancelGeneration = useCallback(() => {
    generationRef.current?.abort()
    generationRef.current = null
  }, [])

  // Lists whatever models the user actually has pulled locally (e.g. a
  // lighter model for quick testing), rather than only offering the one
  // fixed default. Fetched once on mount -- independent of any loaded
  // repo -- with a manual refresh for the common case of starting Ollama
  // after the page is already open.
  const refreshOllamaModels = useCallback(async () => {
    setOllamaModelsLoading(true)
    try {
      const result = await getOllamaModels()
      setOllamaModels(result.models)
      setOllamaModel((current) =>
        current && result.models.includes(current) ? current : (result.models[0] ?? ''),
      )
    } catch {
      // Best-effort: Ollama may simply not be running -- leave the list empty.
    } finally {
      setOllamaModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshOllamaModels()
  }, [refreshOllamaModels])

  const handleLoad = useCallback(async (path: string, docRoot: string, language: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const parseResult = await parseRepo(path, docRoot || undefined, language || undefined)
      const [graph, graphState] = await Promise.all([
        getGraph(parseResult.path),
        getGraphState(parseResult.path),
      ])
      setRepo({
        path: parseResult.path,
        docRoot: parseResult.doc_root,
        nodes: graph.nodes,
        edges: graph.edges,
        nodeCount: parseResult.node_count,
        edgeCount: parseResult.edge_count,
        parseErrors: parseResult.parse_errors,
        positions: graphState.positions,
      })
      setLastRepoPath(path)
      setRememberedDocRoot(path, parseResult.doc_root)
      setRememberedLanguage(path, language)
      setSelectedNodeId(null)
      setPane(null)
      setView('codebase')
      setLens('graph')
      setHealthTab('complexity')
      setFlowchartState(null)
      resetHealthState()
      setDataOnlyActive(false)
      // At or below the threshold: every node id is independently visible,
      // identical to this app's pre-collapse, pre-selection behavior (a
      // node not explicitly in `visibleIds` only rolls up into an
      // ancestor that *is* -- see `buildVisibleGraph` -- so reproducing
      // "everything shown, fully flat" needs every id, not just
      // directory/file ones). Above it: nothing visible at all -- the
      // canvas starts empty (see showEmptySelectionPlaceholder below)
      // rather than rendering every top-level node the user never asked
      // to see.
      //
      // The static demo's own repos are small enough to fall under the
      // threshold, which would otherwise dump every function in a
      // ~90-node repo onto the canvas at once on a stranger's very first
      // click -- a busy first impression this app's real users never hit
      // (a repo they intentionally loaded that small is rare, and one
      // that size is genuinely not cluttered at full detail). Demo mode
      // instead starts collapsed to just the top-level directories/files,
      // the same rollup a real user reaches by checking a few sidebar
      // boxes -- not the large-repo empty canvas either, since a first-
      // time visitor has no reason yet to know that's an available move.
      //
      // A repo with no real subdirectories (every file sits flat at the
      // top level) has no natural grouping for that rollup to collapse
      // into -- "top-level directories/files" is just "every file", the
      // same busy-first-impression problem the threshold above exists to
      // avoid. `getDefaultVisibleIds` returns a curated, small root-id
      // set for exactly that case (see `guava-base`'s `meta.json`); `null`
      // for every other demo repo, whose own directory shape already
      // collapses fine, and always for a non-demo repo.
      const defaultVisibleIds = DEMO_MODE ? await getDefaultVisibleIds(parseResult.path) : null
      const underThreshold = parseResult.node_count <= LARGE_GRAPH_NODE_THRESHOLD
      setVisibleIds(
        defaultVisibleIds
          ? new Set(
              defaultVisibleIds.filter((id) => graph.nodes.some((node) => node.id === id)),
            )
          : DEMO_MODE
            ? rootNodeIds(graph.nodes, graph.edges)
            : underThreshold
              ? new Set(graph.nodes.map((node) => node.id))
              : new Set(),
      )
      setExpandBlockedNotice(null)
      setShowcaseIds(DEMO_MODE ? await getImpactShowcaseIds(parseResult.path) : [])
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [resetHealthState])

  const handleChangeDocRoot = useCallback(async (newDocRoot: string) => {
    const current = repoRef.current
    const trimmed = newDocRoot.trim()
    if (!current || !trimmed) return
    try {
      const result = await updateDocRoot(current.path, trimmed)
      setRememberedDocRoot(current.path, result.doc_root)
      setRepo((prev) => (prev ? { ...prev, docRoot: result.doc_root } : prev))
    } catch (error) {
      setLoadError(errorMessage(error))
    }
  }, [])

  const handleDismissDocSaveNotice = useCallback(() => {
    dismissDocSaveNotice()
    setDocSaveNoticeDismissed(true)
  }, [])

  const selectedNode = useMemo(
    () => repo?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [repo, selectedNodeId],
  )

  // Display labels for the demo's "try these" suggestions -- a showcase id
  // not found on the currently-loaded graph (stale cache, repo switched
  // mid-fetch) is silently dropped rather than shown with a broken label.
  const showcaseItems = useMemo(() => {
    if (!repo) return []
    const byId = new Map(repo.nodes.map((node) => [node.id, node]))
    return showcaseIds
      .map((id) => byId.get(id))
      .filter((node): node is GraphNode => node !== undefined)
      .map((node) => ({ id: node.id, label: formatNodeLabel(node.label, node.accessor_kind) }))
  }, [repo, showcaseIds])

  // Split into two independently-memoized branches, each keyed only on
  // what actually changes its content, rather than one memo keyed on
  // `selectedNode` (which changes on every click, including clicks that
  // don't affect the Codebase-view graph at all -- e.g. jumping between
  // callers in the Impact Analysis pane). A single combined memo would
  // return a fresh object identity on every such click, which cascades
  // into `flowGraph` rebuilding brand-new node/edge objects via dagre,
  // which in turn resets GraphCanvas's own node/edge state (see its
  // `initialNodes` resync effect) -- discarding any live drag position
  // and any highlight/selection styling until the next render catches up.
  // Keyed on `repo.nodes`/`repo.edges` specifically, not `repo` itself --
  // `handleAutoSavePositions` replaces `repo` wholesale every 60s
  // (spreading `positions` into a new object) but always keeps the same
  // `nodes`/`edges` array references, so this stays stable across an
  // autosave tick instead of recomputing (and, via `useLayoutWorker`
  // below, re-running a full off-thread relayout) for a change that never
  // touched graph content.
  const codebaseGraph = useMemo(() => {
    if (!repo) return EMPTY_GRAPH
    return { nodes: repo.nodes, edges: repo.edges }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.nodes, repo?.edges])

  // Debounced, not the raw `visibleIds` -- a rapid burst of checkbox
  // clicks (Milestone 18) should only pay for one `buildVisibleGraph` +
  // layout pass, not one per click. Every other reader of `visibleIds`
  // (the checkbox's own checked state, `showEmptySelectionPlaceholder`)
  // stays on the un-debounced value directly; only this expensive
  // downstream consumer waits.
  const debouncedVisibleIds = useDebouncedValue(visibleIds, VISIBLE_IDS_SETTLE_MS)

  // Resolves `visibleIds` against the full codebase graph into exactly
  // what the canvas renders -- see `buildVisibleGraph`'s own doc comment
  // for the single-set rollup rule this replaces two previously-separate
  // mechanisms with. Referentially stable for the same reason
  // `codebaseGraph` is: only changes identity when `codebaseGraph` or
  // `debouncedVisibleIds` themselves do (load, a checkbox settling, expand/
  // collapse, or selecting a node not yet on canvas -- see
  // handleSelectNode), never on an unrelated re-render, so it doesn't
  // spuriously re-trigger `useLayoutWorker` (see
  // docs/PERFORMANCE-REPORT.md's Iteration 2 for why that worker-side
  // layout exists in the first place).
  const collapsedCodebaseGraph = useMemo(
    () => buildVisibleGraph(codebaseGraph.nodes, codebaseGraph.edges, debouncedVisibleIds),
    [codebaseGraph, debouncedVisibleIds],
  )

  // Ids currently rendered as their own box on the codebase canvas --
  // read (not written) inside `handleSelectNode`, via a ref for the same
  // stable-identity reason as `repoRef`/`paneRef` above.
  const visibleNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    visibleNodeIdsRef.current = new Set(collapsedCodebaseGraph.nodes.map((node) => node.id))
  }, [collapsedCodebaseGraph])

  // The canvas chevron: collapses a currently-expanded container back to
  // one box, or expands it -- unless it has more direct children than
  // `EXPAND_CHILD_THRESHOLD`, in which case nothing on the canvas changes
  // and `expandBlockedNotice` is set instead, telling the user the exact
  // count and pointing them at the sidebar checkboxes to cherry-pick.
  const handleToggleContainer = useCallback(
    (containerId: string) => {
      const current = repoRef.current
      if (!current) return
      const isExpanded = collapsedCodebaseGraph.containerState.get(containerId)?.expanded ?? false
      if (isExpanded) {
        setExpandBlockedNotice(null)
        // Clears every level drilled into under `containerId` (not just
        // its immediate children) -- `containerId` itself was never
        // removed from `visibleIds` by expanding (see below), so it's
        // already there and needs no re-adding.
        setVisibleIds((prev) => {
          const descendants = subtreeIds(containerId, current.edges)
          return new Set([...prev].filter((id) => !descendants.has(id)))
        })
        return
      }
      const children = directChildIds(containerId, current.edges)
      if (children.length > EXPAND_CHILD_THRESHOLD) {
        const label = current.nodes.find((node) => node.id === containerId)?.label ?? containerId
        setExpandBlockedNotice({ label, count: children.length })
        return
      }
      setExpandBlockedNotice(null)
      // Adds the children *alongside* `containerId`, not instead of it --
      // removing the container used to leave its newly-revealed children
      // as disconnected-looking orphans with no visible parent box, and
      // its own sidebar checkbox showing unchecked even though its
      // contents were now on screen. Keeping both visible, connected by
      // their real `defines` edges, is what a directory expanding in any
      // normal file tree looks like.
      setVisibleIds((prev) => new Set([...prev, ...children]))
    },
    [collapsedCodebaseGraph],
  )

  const handleToggleRootSelection = useCallback((id: string) => {
    const current = repoRef.current
    setExpandBlockedNotice(null)
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        // Unchecking cascades: drop `id` and everything currently visible
        // beneath it, not just `id` itself -- otherwise a directory's
        // already-revealed children (from an earlier expand, or from
        // being independently checked) stayed stranded on the canvas
        // after the directory that contained them was unchecked, instead
        // of disappearing along with it the way closing a folder should.
        next.delete(id)
        if (current) {
          for (const descendant of subtreeIds(id, current.edges)) next.delete(descendant)
        }
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleResetSelection = useCallback(() => {
    setExpandBlockedNotice(null)
    setVisibleIds(new Set())
  }, [])

  // One level, for every currently-visible container that's both
  // collapsed and under the expand threshold -- deliberately not a full
  // recursive flatten (that was the old, unbounded "Expand All", which is
  // exactly the runaway-wide-canvas problem this whole redesign fixes).
  // Idempotent: clicking it again expands whatever just became visible
  // and is itself still under threshold, one more level at a time.
  const handleExpandAll = useCallback(() => {
    if (!repo) return
    setExpandBlockedNotice(null)
    setVisibleIds((prev) => {
      const next = new Set(prev)
      for (const [containerId, visibility] of collapsedCodebaseGraph.containerState) {
        if (visibility.expanded) continue
        const children = directChildIds(containerId, repo.edges)
        if (children.length > EXPAND_CHILD_THRESHOLD) continue
        for (const childId of children) next.add(childId)
      }
      return next
    })
  }, [repo, collapsedCodebaseGraph])

  const handleCollapseAll = useCallback(() => {
    if (!repo) return
    setExpandBlockedNotice(null)
    setVisibleIds((prev) => collapseToOutermost(prev, repo.edges))
  }, [repo])

  const fileScopedGraph = useMemo(() => {
    if (!repo || !selectedNode || selectedNode.kind === 'directory') return null
    return scopeToFile(repo.nodes, repo.edges, selectedNode.file)
    // Keyed on the file/kind, not the whole `selectedNode` object, so
    // selecting a different symbol within the same already-scoped file
    // doesn't recompute this (and doesn't need to -- the scoped node/edge
    // set is identical either way). Deliberately not exhaustive: adding
    // `selectedNode` itself back in would defeat the point. Same
    // nodes/edges-not-repo reasoning as `codebaseGraph` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.nodes, repo?.edges, selectedNode?.file, selectedNode?.kind])

  const scopedGraph = view === 'file' && fileScopedGraph ? fileScopedGraph : collapsedCodebaseGraph

  const layout = useLayoutWorker(scopedGraph)

  const flowGraph = useMemo(() => {
    if (!repo || Object.keys(repo.positions).length === 0) {
      return { nodes: layout.nodes, edges: layout.edges }
    }
    const fixedIds = new Set(Object.keys(repo.positions))
    const positioned = layout.nodes.map((node) => {
      const saved = repo.positions[node.id]
      return saved ? { ...node, position: { x: saved.x, y: saved.y } } : node
    })
    // A restored drag can land dagre's fresh layout for everything *else*
    // right on top of it -- dagre's own collision-free guarantee only
    // holds among the positions it computed, and `saved` above just
    // overrode some of those. Nudges only the non-fixed (freshly laid
    // out) nodes clear of it; see `resolveNodeOverlaps`'s own comment.
    return { nodes: resolveNodeOverlaps(positioned, fixedIds), edges: layout.edges }
  }, [layout, repo])

  const handleViewSource = useCallback(
    async (nodeId: string) => {
      if (!repo) return
      // Inside the VS Code extension's webview, jump straight to the real
      // file/line in the actual editor instead of fetching a read-only
      // inline snippet -- strictly better when the editor is right there,
      // and the extension host owns opening/revealing it (`openSource`,
      // handled in `vscode-extension/src/extension.ts`).
      if (vscodeApi) {
        const node = repo.nodes.find((candidate) => candidate.id === nodeId)
        if (node) {
          // `repo.path` is the actual root the currently-loaded graph was
          // parsed from -- not necessarily the VS Code workspace folder,
          // since the repo-path field above lets a user point this same
          // webview at any local checkout. The extension host must resolve
          // `node.file` against *this* root, not assume its own workspace
          // root, or "View Source" opens a nonexistent path whenever the
          // two differ.
          vscodeApi.postMessage({
            command: 'openSource',
            path: repo.path,
            file: node.file,
            line: node.line_start,
          })
        }
        return
      }
      setPane({ kind: 'source', status: 'loading' })
      try {
        const result = await getFunctionSource(repo.path, nodeId)
        setPane({ kind: 'source', status: 'loaded', source: result.source })
      } catch (error) {
        setPane({ kind: 'source', status: 'error', message: errorMessage(error) })
      }
    },
    [repo],
  )

  const handleDocument = useCallback(
    async (nodeId: string) => {
      if (!repo) return
      cancelGeneration()
      setPane({ kind: 'doc', status: 'loading' })
      try {
        const result = await getDoc(repo.path, nodeId)
        setPane({ kind: 'doc', status: 'loaded', markdown: result.markdown, saved: true })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setPane({ kind: 'doc', status: 'not-found' })
        } else {
          setPane({ kind: 'doc', status: 'error', message: errorMessage(error) })
        }
      }
    },
    [repo, cancelGeneration],
  )

  const handleGenerateDoc = useCallback(async () => {
    if (!repo || !selectedNodeId) return
    cancelGeneration()
    const controller = new AbortController()
    generationRef.current = controller

    setPane({ kind: 'doc', status: 'generating', markdown: '' })
    try {
      let markdown = ''
      const model = docProvider === 'ollama' ? ollamaModel || undefined : undefined
      for await (const chunk of streamDoc(
        repo.path,
        selectedNodeId,
        docProvider,
        model,
        controller.signal,
      )) {
        // A chunk can arrive after `abort()` was already called (the
        // underlying fetch/reader hasn't rejected yet) -- checking here,
        // not just after the loop, stops it from being applied to a pane
        // that may since belong to a different node or action.
        if (controller.signal.aborted) return
        markdown += chunk
        setPane({ kind: 'doc', status: 'generating', markdown })
      }
      if (controller.signal.aborted) return
      setPane({ kind: 'doc', status: 'loaded', markdown, saved: false })
    } catch (error) {
      if (controller.signal.aborted) return
      setPane({ kind: 'doc', status: 'error', message: errorMessage(error) })
    }
  }, [repo, selectedNodeId, docProvider, ollamaModel, cancelGeneration])

  const handleSaveDoc = useCallback(async () => {
    const current = paneRef.current
    if (!repo || !selectedNodeId || current?.kind !== 'doc' || current.status !== 'loaded') return
    try {
      await saveDoc(repo.path, selectedNodeId, current.markdown)
      setPane({ kind: 'doc', status: 'loaded', markdown: current.markdown, saved: true })
    } catch (error) {
      setPane({ kind: 'doc', status: 'error', message: errorMessage(error) })
    }
  }, [repo, selectedNodeId])

  const handleEditDoc = useCallback((markdown: string) => {
    setPane((prev) =>
      prev?.kind === 'doc' && prev.status === 'loaded'
        ? { kind: 'doc', status: 'loaded', markdown, saved: false }
        : prev,
    )
  }, [])

  const handleExecutionFlowchart = useCallback(
    async (nodeId: string) => {
      if (!repo) return
      const targetNode = repo.nodes.find((node) => node.id === nodeId)
      const label = targetNode ? formatNodeLabel(targetNode.label, targetNode.accessor_kind) : nodeId
      setSelectedNodeId(nodeId)
      setFlowchartState({ status: 'loading', label })
      try {
        const data = await getFlowchart(repo.path, nodeId)
        setFlowchartState({ status: 'loaded', label, data })
      } catch (error) {
        setFlowchartState({ status: 'error', label, message: errorMessage(error) })
      }
    },
    [repo],
  )

  const handleBackToGraph = useCallback(() => {
    setFlowchartState(null)
  }, [])

  const flowchartGraph = useMemo(() => {
    if (!flowchartState || flowchartState.status !== 'loaded') return null
    return buildFlowchartGraph(flowchartState.data.nodes, flowchartState.data.edges)
  }, [flowchartState])

  const handleImpactAnalysis = useCallback(
    async (nodeId: string) => {
      if (!repo) return
      setPane({ kind: 'impact', status: 'loading' })
      try {
        const result = await getImpact(repo.path, nodeId)
        setPane({ kind: 'impact', status: 'loaded', result })
      } catch (error) {
        setPane({ kind: 'impact', status: 'error', message: errorMessage(error) })
      }
    },
    [repo],
  )

  // Activates the Code Health lens -- idempotent, browser-tab-style:
  // switching to it just flips `lens`, and only fetches complexity/refs the
  // *first* time this repo-session (guarded on `dashboard === null`), never
  // on a later switch back. Cancels any in-flight doc generation and clears
  // `pane`/`flowchartState` since those belong to the Graph lens, which is
  // no longer on screen once this fires -- but only on that first
  // activation. A switch-back (the `if (dashboard) return` below) leaves an
  // in-flight doc generation running in the background rather than
  // cancelling it, deliberately: the same "switching lenses doesn't destroy
  // the other lens's state" contract this whole redesign is built on.
  const handleActivateHealthLens = useCallback(async () => {
    if (!repo) return
    setLens('health')
    if (dashboard) return
    cancelGeneration()
    setPane(null)
    setFlowchartState(null)
    setDashboard({ status: 'loading' })
    setGitRefs({ status: 'loading' })
    const requestId = ++dashboardRequestIdRef.current
    try {
      const result = await getComplexity(repo.path)
      if (dashboardRequestIdRef.current !== requestId) return
      setDashboard({ status: 'loaded', scores: result.scores })
    } catch (error) {
      if (dashboardRequestIdRef.current !== requestId) return
      setDashboard({ status: 'error', message: errorMessage(error) })
    }
    // Independent of the scores fetch above (same `requestId` guard, but
    // its own try/catch) -- a slow or failed refs lookup shouldn't block
    // or fail the scores the ranked list actually needs to render.
    try {
      const refs = await getGitRefs(repo.path)
      if (dashboardRequestIdRef.current !== requestId) return
      setGitRefs({ status: 'loaded', refs })
    } catch (error) {
      if (dashboardRequestIdRef.current !== requestId) return
      setGitRefs({ status: 'error', message: errorMessage(error) })
    }
  }, [repo, dashboard, cancelGeneration])

  const handleActivateGraphLens = useCallback(() => {
    setLens('graph')
  }, [])

  // Re-parses the repo (picking up whatever changed on disk since it was
  // last parsed -- an AI agent's edit, or a hand edit) and diffs the fresh
  // complexity scores against whatever was cached the last time this path's
  // complexity was computed. Deliberately not `handleLoad`: that resets
  // selection/view/visibleIds/etc. far beyond what a compare-while-already-
  // in-the-dashboard action should touch -- this instead refreshes `repo` in
  // place, the same shape `handleDataSourceIngestComplete` below already
  // uses for "merge fresh data into state without resetting everything else."
  const handleCompareDashboard = useCallback(async () => {
    if (!repo || dashboard?.status !== 'loaded') return
    const requestId = ++dashboardDiffRequestIdRef.current
    const mode: DiffMode = { kind: 'last-look' }
    setDashboardDiff({ status: 'loading', mode })
    try {
      // `getLastRepoPath()`, not `repo.path` -- `setRememberedLanguage` was
      // written under the *raw* path passed to `handleLoad`, but `repo.path`
      // is the backend-resolved one (`cache.py`'s own `Path(path).resolve()`);
      // they can differ (Windows path separators, relative vs. resolved), so
      // looking up by `repo.path` would silently miss and reparse with the
      // wrong language. Mirrors exactly how `rememberedLanguage` is looked up
      // for the initial load below.
      const language = getRememberedLanguage(getLastRepoPath() ?? repo.path) ?? undefined
      const parseResult = await parseRepo(repo.path, repo.docRoot, language)
      const graph = await getGraph(parseResult.path)
      if (dashboardDiffRequestIdRef.current !== requestId) return
      setRepo((prev) =>
        prev
          ? {
              ...prev,
              nodes: graph.nodes,
              edges: graph.edges,
              nodeCount: parseResult.node_count,
              edgeCount: parseResult.edge_count,
              parseErrors: parseResult.parse_errors,
            }
          : prev,
      )
      // A function this compare removed can have been visible (in
      // `visibleIds`) before the edit -- `buildVisibleGraph` already ignores
      // an id with no matching node, so nothing renders wrong, but leaving it
      // in place would silently inflate the sidebar's own "N on canvas" count
      // (a plain `visibleIds.size`, `Sidebar.tsx`) forever after.
      const freshNodeIds = new Set(graph.nodes.map((node) => node.id))
      setVisibleIds((prev) => new Set([...prev].filter((id) => freshNodeIds.has(id))))
      const diffResult = await getComplexityDiff(repo.path)
      if (dashboardDiffRequestIdRef.current !== requestId) return
      setDashboard({ status: 'loaded', scores: diffResult.current })
      setDashboardDiff({ status: 'loaded', mode, result: diffResult })
      // Mirrors `handleDataSourceIngestComplete`'s existing precedent of
      // auto-revealing nodes the user has no other way to discover -- a
      // function only in `added` is exactly that; `changed` entries already
      // existed, so (matching today's ranked-list behavior, which never
      // auto-reveals) those stay click-to-select only.
      if (diffResult.added.length > 0) {
        setVisibleIds((prev) => new Set([...prev, ...diffResult.added.map((score) => score.node_id)]))
      }
    } catch (error) {
      if (dashboardDiffRequestIdRef.current !== requestId) return
      setDashboardDiff({ status: 'error', mode, message: errorMessage(error) })
    }
  }, [repo, dashboard])

  // The Idea 3a counterpart to `handleCompareDashboard` above: diffs one
  // arbitrary git ref's complexity against either the repo's already-
  // current on-disk state (`toRef` omitted -- the common case) or a
  // second arbitrary ref (`toRef` given, comparing two historical points
  // against each other with no dependency on current disk state at all).
  // Unlike `handleCompareDashboard`, this never reparses `repo` -- when
  // `toRef` is omitted, diff-ref compares state already reflected in
  // `dashboard`/`repo` against `ref`, so there's nothing to refresh.
  const handleCompareDashboardToRef = useCallback(
    async (ref: string, label: string, toRef?: string, toLabel?: string) => {
      if (!repo || dashboard?.status !== 'loaded') return
      const requestId = ++dashboardDiffRequestIdRef.current
      const mode: DiffMode = { kind: 'ref', ref, label, toRef, toLabel }
      setDashboardDiff({ status: 'loading', mode })
      try {
        const result = await getComplexityDiffRef(repo.path, ref, toRef)
        if (dashboardDiffRequestIdRef.current !== requestId) return
        setDashboardDiff({ status: 'loaded', mode, result })
      } catch (error) {
        if (dashboardDiffRequestIdRef.current !== requestId) return
        setDashboardDiff({ status: 'error', mode, message: errorMessage(error) })
      }
    },
    [repo, dashboard],
  )

  // Fetches the Hotspots tab's ranking for a given churn window -- called
  // lazily by `CodeHealthSidebar` (first tab open, then again on every
  // window-size change), never eagerly alongside the rest of the dashboard.
  // Deliberately only guarded on `repo` existing, unlike the two compare
  // handlers above (which also require `dashboard?.status === 'loaded'`
  // since a compare replaces/reads the dashboard's own scores) -- hotspots
  // data is independent of the complexity fetch, so gating on it too would
  // silently no-op a click on the Hotspots tab made before that unrelated
  // fetch resolves (the tab itself isn't disabled while it's in flight,
  // unlike the Compare button), leaving the tab stuck on "Loading…" until
  // a second click happened to land after `dashboard` settled.
  const handleLoadHotspots = useCallback(
    async (windowDays: number) => {
      if (!repo) return
      const requestId = ++hotspotsRequestIdRef.current
      setHotspots({ status: 'loading', windowDays })
      try {
        const result = await getComplexityHotspots(repo.path, windowDays)
        if (hotspotsRequestIdRef.current !== requestId) return
        setHotspots({ status: 'loaded', windowDays, result })
      } catch (error) {
        if (hotspotsRequestIdRef.current !== requestId) return
        setHotspots({ status: 'error', windowDays, message: errorMessage(error) })
      }
    },
    [repo],
  )

  // Fetches the Dead Code tab's candidate list -- lazily, on first open,
  // same "only guarded on `repo`" reasoning as `handleLoadHotspots` above
  // (dead-code detection is independent of the complexity fetch too).
  const handleLoadDeadCode = useCallback(async () => {
    if (!repo) return
    const requestId = ++deadCodeRequestIdRef.current
    setDeadCode({ status: 'loading' })
    try {
      const result = await getDeadCode(repo.path)
      if (deadCodeRequestIdRef.current !== requestId) return
      setDeadCode({ status: 'loaded', result })
    } catch (error) {
      if (deadCodeRequestIdRef.current !== requestId) return
      if (error instanceof DeadCodeUnavailableError) {
        setDeadCode({ status: 'unavailable', message: error.message })
      } else {
        setDeadCode({ status: 'error', message: errorMessage(error) })
      }
    }
  }, [repo])

  const handleToggleDataSource = useCallback(() => {
    if (!repo) return
    if (pane?.kind === 'dataSource') {
      setPane(null)
      return
    }
    cancelGeneration()
    setPane({ kind: 'dataSource' })
  }, [repo, pane, cancelGeneration])

  // Ingesting a dbt manifest or a live DB connection merges new
  // nodes/edges into the backend's cached `ParseResult`, not into this
  // app's own `repo` state -- re-fetching the graph is the only way the
  // new `Table`/`DBT_MODEL` nodes actually show up on the canvas.
  // Positions/node/edge counts elsewhere in `repo` are left as-is; only
  // `nodes`/`edges` are replaced, same as everywhere else in this file
  // that updates `repo` incrementally rather than reloading from scratch.
  const handleDataSourceIngestComplete = useCallback(async () => {
    const current = repoRef.current
    if (!current) return
    try {
      const graph = await getGraph(current.path)
      // A `Table`/`DBT_MODEL` node has no `defines` edge pointing at it
      // (nothing "contains" it the way a file contains a function), so
      // it's root-level by `rootNodeIds`'s definition -- without this, a
      // newly-ingested node would silently need the user to go find and
      // check it in the sidebar before it ever renders, unlike
      // everything else this app auto-reveals on selection (see
      // handleSelectNode's own ancestor/root-selection logic below).
      const previousIds = new Set(current.nodes.map((node) => node.id))
      const newlyIngestedRootIds = Array.from(rootNodeIds(graph.nodes, graph.edges)).filter(
        (id) => !previousIds.has(id),
      )

      setRepo((prev) => (prev ? { ...prev, nodes: graph.nodes, edges: graph.edges } : prev))
      if (newlyIngestedRootIds.length > 0) {
        setVisibleIds((prev) => new Set([...prev, ...newlyIngestedRootIds]))
      }
    } catch {
      // Best-effort: the pane already showed its own success/error
      // confirmation for the ingest itself -- a failed refresh just means
      // the canvas catches up on the next reload instead of live.
    }
  }, [])

  // Clicking empty canvas space already deselects (calls this with
  // `null`); it also clears the active pane, so an Impact
  // Analysis/Document/Source pane -- and the graph highlighting that
  // comes with it -- has an obvious way out instead of staying stuck
  // until some other context-menu action happens to replace it.
  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      cancelGeneration()
      setSelectedNodeId(nodeId)
      if (nodeId === null) {
        setPane(null)
        return
      }
      // A selection can come from somewhere that isn't collapse-aware --
      // the sidebar's file/symbol tree (`Tree.tsx`), or jumping to a
      // caller from the Impact Analysis pane -- and the target could be
      // rolled up inside a currently-collapsed directory/file, or not
      // visible on the canvas at all yet.
      //
      // Under the unified `visibleIds` model, making it visible is just
      // adding its id directly: `buildVisibleGraph` checks
      // `visibleIds.has(id)` *before* ever consulting a parent, so a node
      // added this way always renders as its own standalone box
      // immediately, regardless of its ancestors' state -- no ancestor
      // expansion, no swept-in siblings. (The old two-set model couldn't
      // do this: force-expanding a container to reveal one descendant
      // necessarily revealed *every* other child of that container too --
      // confirmed live against a real large repo, where selecting one
      // small nested directory dumped ~30 unrelated siblings onto the
      // canvas alongside it.)
      //
      // Skip the update entirely when `nodeId` is already rendering as
      // its own box (`visibleNodeIdsRef`, mirroring
      // `collapsedCodebaseGraph`) -- the overwhelmingly common case
      // (opening a context menu, jumping to a caller already on screen)
      // -- so a plain click on an already-visible node never forces a
      // selection recompute/relayout.
      if (visibleNodeIdsRef.current.has(nodeId)) return
      setVisibleIds((prev) => new Set(prev).add(nodeId))
    },
    [cancelGeneration],
  )

  // Wraps `handleSelectNode` for the VS Code host's `postMessage` bridge,
  // which can arrive at any time regardless of which lens is currently
  // showing -- switches back to the Graph lens first, since a "jump to
  // this file/function" message is inherently a Graph-lens activity.
  // Deliberately not folded into `handleSelectNode` itself:
  // `CodeHealthSidebar`'s own ranked list also calls `handleSelectNode`
  // directly when a row is clicked, and should behave exactly like the
  // narrow side-panel report always has -- silently adding the node to the
  // canvas underneath without booting the user out of the Code Health lens
  // they're reading, not switching lenses on every click.
  const handleExternalSelectNode = useCallback(
    (nodeId: string | null) => {
      if (lens === 'health') setLens('graph')
      handleSelectNode(nodeId)
    },
    [lens, handleSelectNode],
  )

  // One click, from the demo's own "try these" suggestions, does what a
  // first-time visitor would otherwise need two separate discoveries for
  // (that a node can be brought onto the canvas at all, and that
  // right-click has an Impact Analysis item) -- selects the suggested
  // function (bringing it onto the canvas as its own box, per
  // `handleSelectNode` above) and runs impact analysis on it immediately.
  const handleTryShowcase = useCallback(
    (nodeId: string) => {
      handleSelectNode(nodeId)
      void handleImpactAnalysis(nodeId)
    },
    [handleSelectNode, handleImpactAnalysis],
  )

  // `onMessage` below needs the *latest* `handleExternalSelectNode`/
  // `handleImpactAnalysis` on every call, but re-registering the
  // `window` listener every time either identity changes (they're
  // `useCallback`'d on `repo`/`pane`/`dashboard`, not stable) would mean
  // churn on most graph interactions -- a plain ref updated every render
  // (same pattern as `repoRef` above) keeps the listener itself mounted
  // once. Uses `handleExternalSelectNode`, not `handleSelectNode` directly,
  // since a host message is exactly the kind of external trigger that
  // should close the dashboard if it's open (see that callback's comment).
  const messageHandlersRef = useRef({ handleSelectNode: handleExternalSelectNode, handleImpactAnalysis })
  messageHandlersRef.current = { handleSelectNode: handleExternalSelectNode, handleImpactAnalysis }

  // Bridges messages from the VS Code extension host (see
  // `vscode-extension/src/extension.ts`) into the same handlers a normal
  // user interaction already drives, rather than a separate code path:
  // `activeFileChanged` mirrors clicking a file then switching to the
  // File view; `runImpactAnalysis` mirrors right-clicking a node on the
  // canvas and choosing Impact Analysis (which also selects the node
  // first -- see `GraphCanvas.tsx`'s `handleNodeContextMenu` -- so this
  // does the same). A no-op outside the extension's webview, since
  // `vscodeApi` is null there and no listener is ever attached.
  useEffect(() => {
    if (!vscodeApi) return
    function onMessage(event: MessageEvent<unknown>) {
      const data = event.data
      // A same-window `postMessage` can in principle come from anywhere
      // (not just the extension host) -- shape-checked before acting on
      // it, rather than trusting `command` to be one of `HostMessage`'s
      // literal values just because TypeScript says so.
      if (typeof data !== 'object' || data === null || !('command' in data)) return
      const message = data as HostMessage
      const { handleSelectNode: selectNode, handleImpactAnalysis: runImpact } =
        messageHandlersRef.current
      if (message.command === 'activeFileChanged') {
        const fileNode = repoRef.current?.nodes.find(
          (node) => node.id === message.file && node.kind === 'file',
        )
        if (!fileNode) return
        selectNode(fileNode.id)
        setView('file')
      } else if (message.command === 'runImpactAnalysis') {
        selectNode(message.nodeId)
        runImpact(message.nodeId)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // Mount-once: `onMessage` always reads the latest handlers via
    // `messageHandlersRef`, so it never needs to be torn down/re-added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClosePane = useCallback(() => {
    cancelGeneration()
    setPane(null)
  }, [cancelGeneration])

  const impactHighlight: GraphHighlight | null = useMemo(() => {
    if (pane?.kind !== 'impact' || pane.status !== 'loaded') return null
    const { result } = pane
    return {
      nodeIds: new Set([result.target, ...result.callers.map((caller) => caller.id)]),
      edgeKeys: new Set(result.edges.map((edge) => `${edge.source}->${edge.target}`)),
    }
  }, [pane])

  // Every table/dbt-model node, plus anything directly connected to one by
  // a `DATA_LINEAGE_EDGE_KINDS` edge (an ORM class, a function that reads/
  // writes it, another table via foreign key, another dbt model via
  // `ref()`) -- table/dbt-model nodes are always included even with no
  // matching edge yet (a freshly introspected table with no detected
  // foreign key still has a node but no edge). A dim-in-place filter over
  // the same graph, not a separate scoped view, so right-clicking a table
  // still traverses code and data together.
  const dataLineageHighlight: GraphHighlight | null = useMemo(() => {
    if (!dataOnlyActive || !repo) return null
    const nodeIds = new Set<string>()
    const edgeKeys = new Set<string>()
    for (const node of repo.nodes) {
      if (node.kind === 'table' || node.kind === 'dbt_model') nodeIds.add(node.id)
    }
    for (const edge of repo.edges) {
      if (!DATA_LINEAGE_EDGE_KINDS.has(edge.kind)) continue
      nodeIds.add(edge.source)
      nodeIds.add(edge.target)
      edgeKeys.add(`${edge.source}->${edge.target}`)
    }
    return { nodeIds, edgeKeys }
  }, [dataOnlyActive, repo])

  // Stable identity (no `repo` dependency, read via `repoRef` instead) so
  // GraphCanvas's auto-save interval effect doesn't tear down and recreate
  // itself -- and the scopedGraph/flowGraph memos below don't invalidate
  // and re-run dagre layout -- on every single autosave tick. The API call
  // stays a plain statement in the callback body rather than inside the
  // setRepo updater: React (StrictMode in particular) may invoke a
  // functional state update more than once to check it's pure, and a
  // network call inside it would double-fire. Positions are merged into
  // whatever's already in state (mirroring the backend's own merge-on-save)
  // since a save only ever carries positions for whatever nodes are
  // currently rendered -- e.g. the File view shows a scoped subset -- so
  // replacing wholesale would drop every other node's remembered position.
  const handleAutoSavePositions = useCallback((positions: Record<string, NodePosition>) => {
    const current = repoRef.current
    if (!current) return
    void saveGraphState(current.path, positions).catch(() => {
      // Best-effort: a failed autosave shouldn't interrupt the user.
    })
    setRepo((prev) => (prev ? { ...prev, positions: { ...prev.positions, ...positions } } : prev))
  }, [])

  const showFileViewPlaceholder =
    repo !== null && view === 'file' && (!selectedNode || selectedNode.kind === 'directory')

  const showEmptySelectionPlaceholder = repo !== null && view === 'codebase' && visibleIds.size === 0

  const lastRepoPath = getLastRepoPath()
  const rememberedDocRoot = lastRepoPath ? getRememberedDocRoot(lastRepoPath) : null
  const rememberedLanguage = lastRepoPath ? getRememberedLanguage(lastRepoPath) : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: colors.bgPage,
        color: colors.textPrimary,
        fontFamily: font.ui,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.lg,
          padding: spacing.md,
          borderBottom: `1px solid ${colors.bgPanel}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexShrink: 0 }}>
          <LogoMark size={20} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Semantic Vision
          </span>
          {DEMO_MODE && (
            <a
              href="https://github.com/venom21adi/Semantic_Vision"
              target="_blank"
              rel="noreferrer"
              title="Static demo with precomputed data -- no backend. Get it for your own repo on GitHub."
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                color: colors.accent,
                border: `1px solid ${colors.accent}`,
                borderRadius: radius.full,
                padding: '2px 7px',
                textDecoration: 'none',
              }}
            >
              Static demo · Get it for your repo →
            </a>
          )}
        </div>
        {repo && (
          <div style={{ display: 'flex', gap: spacing.xs, flexShrink: 0 }}>
            <LensTabButton label="Codebase Graph" active={lens === 'graph'} onClick={handleActivateGraphLens} />
            <LensTabButton label="Code Health" active={lens === 'health'} onClick={() => void handleActivateHealthLens()} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {repo && DEMO_MODE && (
            <DemoRepoPill slug={repo.path} onSwitch={() => setRepo(null)} />
          )}
          {repo && !DEMO_MODE && (
            <RepoPill
              onLoad={handleLoad}
              loading={loading}
              error={loadError}
              initialPath={lastRepoPath ?? undefined}
              initialDocRoot={rememberedDocRoot ?? undefined}
              initialLanguage={rememberedLanguage ?? undefined}
              resolvedDocRoot={repo.docRoot}
              onChangeDocRoot={handleChangeDocRoot}
              stats={{
                path: repo.path,
                nodeCount: repo.nodeCount,
                edgeCount: repo.edgeCount,
                parseErrors: repo.parseErrors,
              }}
            />
          )}
        </div>
        <HelpGuide />
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {repo && lens === 'graph' && (
          <Sidebar
            nodes={repo.nodes}
            edges={repo.edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleExternalSelectNode}
            view={view}
            onViewChange={setView}
            dataSourceActive={pane?.kind === 'dataSource'}
            onToggleDataSource={handleToggleDataSource}
            dataOnlyActive={dataOnlyActive}
            onToggleDataOnly={handleToggleDataOnly}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            selectedRootIds={visibleIds}
            onToggleRootSelection={handleToggleRootSelection}
            onResetSelection={handleResetSelection}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        )}
        {repo && lens === 'health' && (
          <CodeHealthSidebar
            healthTab={healthTab}
            onHealthTabChange={setHealthTab}
            state={dashboard ?? { status: 'loading' }}
            path={repo.path}
            graphNodes={repo.nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            hotspots={hotspots}
            onLoadHotspots={handleLoadHotspots}
            deadCode={deadCode}
            onLoadDeadCode={handleLoadDeadCode}
          />
        )}
        {lens === 'health' && repo ? (
          <CodeHealthDetail
            healthTab={healthTab}
            state={dashboard ?? { status: 'loading' }}
            diff={dashboardDiff}
            onCompare={handleCompareDashboard}
            gitRefs={gitRefs}
            onCompareToRef={handleCompareDashboardToRef}
            graphNodes={repo.nodes}
            graphEdges={repo.edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
          />
        ) : (
          <>
            <main style={{ flex: 1, minWidth: 0 }}>
              {!repo && !flowchartState && (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: spacing.lg,
                  }}
                >
                  <LogoMark size={40} bare />
                  <div style={{ fontSize: 15, color: colors.textMuted }}>
                    Load a repository to see its codebase graph.
                  </div>
                  <div style={{ width: '100%', maxWidth: 640, padding: `0 ${spacing.md}px` }}>
                    {DEMO_MODE ? (
                      <DemoRepoPicker onLoad={handleLoad} loading={loading} error={loadError} />
                    ) : (
                      <RepoLoader
                        onLoad={handleLoad}
                        loading={loading}
                        error={loadError}
                        initialPath={lastRepoPath ?? undefined}
                        initialDocRoot={rememberedDocRoot ?? undefined}
                        initialLanguage={rememberedLanguage ?? undefined}
                        resolvedDocRoot={null}
                        stats={null}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      maxWidth: 360,
                      textAlign: 'center',
                      fontSize: 12,
                      color: colors.textDim,
                      lineHeight: 1.5,
                    }}
                  >
                    Once it's in, right-click any node for docs, impact analysis, and execution
                    flowcharts — see the <strong>?</strong> in the top-right corner for a full
                    walkthrough.
                  </div>
                </div>
              )}
              {repo && !flowchartState && showFileViewPlaceholder && (
                <div style={{ padding: 24, color: colors.textMuted }}>
                  Select a file, class, or function to see its file view.
                </div>
              )}
              {repo && !flowchartState && !showFileViewPlaceholder && showEmptySelectionPlaceholder && (
                <div style={{ padding: 24, color: colors.textMuted }}>
                  Select a directory or file in the sidebar to add it to the canvas.
                </div>
              )}
              {repo &&
                !flowchartState &&
                !showFileViewPlaceholder &&
                !showEmptySelectionPlaceholder &&
                (layout.status === 'idle' || layout.status === 'laying-out') && (
                  <div style={{ padding: 24, color: colors.textMuted }}>
                    Laying out {scopedGraph.nodes.length} nodes…
                  </div>
                )}
              {repo &&
                !flowchartState &&
                !showFileViewPlaceholder &&
                !showEmptySelectionPlaceholder &&
                layout.status === 'error' && (
                  <div style={{ padding: 24 }}>
                    <span role="alert" style={{ color: colors.danger }}>
                      Failed to lay out the graph. Try switching views or reloading the repository.
                    </span>
                  </div>
                )}
              {repo &&
                !flowchartState &&
                !showFileViewPlaceholder &&
                !showEmptySelectionPlaceholder &&
                layout.status === 'ready' && (
                  <GraphCanvas
                    key={`${repo.path}:${view}:${view === 'file' ? selectedNode?.file : ''}`}
                    nodes={flowGraph.nodes}
                    edges={flowGraph.edges}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    onDocument={handleDocument}
                    onImpactAnalysis={handleImpactAnalysis}
                    onViewSource={handleViewSource}
                    onExecutionFlowchart={handleExecutionFlowchart}
                    onToggleContainer={handleToggleContainer}
                    containerState={view === 'codebase' ? collapsedCodebaseGraph.containerState : undefined}
                    expandBlockedNotice={view === 'codebase' ? expandBlockedNotice : null}
                    onAutoSavePositions={handleAutoSavePositions}
                    highlight={impactHighlight ?? dataLineageHighlight}
                    hiddenEdgeKinds={hiddenEdgeKinds}
                    onToggleEdgeKind={handleToggleEdgeKind}
                  />
                )}
              {flowchartState?.status === 'loading' && (
                <div style={{ padding: 24, color: colors.textMuted }}>Loading flowchart…</div>
              )}
              {flowchartState?.status === 'error' && (
                <div style={{ padding: 24 }}>
                  <span role="alert" style={{ color: colors.danger }}>
                    {flowchartState.message}
                  </span>
                  <div style={{ marginTop: 12 }}>
                    <button
                      onClick={handleBackToGraph}
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
              )}
              {flowchartState?.status === 'loaded' && flowchartGraph && (
                <FlowchartCanvas
                  targetLabel={flowchartState.label}
                  nodes={flowchartGraph.nodes}
                  edges={flowchartGraph.edges}
                  onBack={handleBackToGraph}
                />
              )}
            </main>
            <DetailsPanel
              selectedNode={selectedNode}
              pane={pane}
              onSelectCaller={handleSelectNode}
              onClosePane={handleClosePane}
              docProvider={docProvider}
              onDocProviderChange={setDocProvider}
              ollamaModels={ollamaModels}
              ollamaModelsLoading={ollamaModelsLoading}
              ollamaModel={ollamaModel}
              onOllamaModelChange={setOllamaModel}
              onRefreshOllamaModels={refreshOllamaModels}
              onGenerateDoc={handleGenerateDoc}
              onSaveDoc={handleSaveDoc}
              onEditDoc={handleEditDoc}
              docRoot={repo?.docRoot ?? ''}
              docSaveNoticeDismissed={docSaveNoticeDismissed}
              onDismissDocSaveNotice={handleDismissDocSaveNotice}
              repoPath={repo?.path ?? ''}
              onDataSourceIngestComplete={handleDataSourceIngestComplete}
              dataSourceDefaultManifestPath={
                DEMO_MODE && repo?.path === 'python-shop'
                  ? 'jaffle_shop/target/manifest.json (bundled with this demo)'
                  : undefined
              }
              showcaseItems={showcaseItems}
              onTryShowcase={handleTryShowcase}
              collapsed={detailsCollapsed}
              onToggleCollapsed={toggleDetailsCollapsed}
              width={detailsWidth}
              onResizeWidth={handleResizeDetailsWidth}
            />
          </>
        )}
      </div>
    </div>
  )
}
