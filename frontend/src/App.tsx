import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  getComplexity,
  getDoc,
  getFlowchart,
  getFunctionSource,
  getGraph,
  getGraphState,
  getImpact,
  getOllamaModels,
  parseRepo,
  saveDoc,
  saveGraphState,
  streamDoc,
  updateDocRoot,
} from './api/client'
import type {
  ComplexityScore,
  DocProvider,
  FlowchartResponse,
  GraphEdge,
  GraphNode,
  NodePosition,
  ParseErrorInfo,
} from './api/types'
import { DetailsPanel, type ActivePane } from './components/DetailsPanel'
import { RepoLoader } from './components/RepoLoader'
import { Sidebar, type GraphView } from './components/Sidebar'
import { FlowchartCanvas } from './flowchart/FlowchartCanvas'
import { buildFlowchartGraph } from './flowchart/transform'
import { ancestorContainerIds, collapseGraph, subgraphForSelection } from './graph/collapseDirectories'
import { GraphCanvas, LARGE_GRAPH_NODE_THRESHOLD, type GraphHighlight } from './graph/GraphCanvas'
import { scopeToFile } from './graph/transform'
import { useLayoutWorker } from './graph/useLayoutWorker'
import { rootNodeIds } from './tree/buildTree'
import {
  dismissDocSaveNotice,
  getDetailsCollapsed,
  getLastRepoPath,
  getRememberedDocRoot,
  getRememberedLanguage,
  getSidebarCollapsed,
  isDocSaveNoticeDismissed,
  setDetailsCollapsed,
  setLastRepoPath,
  setRememberedDocRoot,
  setRememberedLanguage,
  setSidebarCollapsed,
} from './utils/localStorage'

const EMPTY_GRAPH: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] }

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

type FlowchartState =
  | { status: 'loading'; label: string }
  | { status: 'loaded'; label: string; data: FlowchartResponse }
  | { status: 'error'; label: string; message: string }

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
  // Which directories/files currently show their children as separate
  // nodes, rather than rolled up into the container node itself. Both
  // kinds are collapse boundaries (see collapseDirectories.ts) -- a
  // single large file needs collapsing just as much as a directory does.
  // Defaulted on load (see handleLoad): every directory/file for a repo
  // at or below the large-graph threshold (today's exact behavior,
  // unchanged), otherwise empty (so a large repo starts showing only its
  // top-level structure).
  const [expandedContainerIds, setExpandedContainerIds] = useState<ReadonlySet<string>>(new Set())
  // Which top-level directories/files the user has explicitly chosen to
  // show on the codebase-view canvas at all -- independent of
  // `expandedContainerIds`, which only controls whether an already-shown
  // container's contents are rolled up or not. The canvas starts empty
  // (see handleLoad) rather than auto-populating with every top-level
  // node, so a large repo never renders as one wide row of directories the
  // user never asked to see; a repo at/below the large-graph threshold
  // still starts fully selected, matching today's zero-click behavior.
  const [selectedRootIds, setSelectedRootIds] = useState<ReadonlySet<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => getSidebarCollapsed())
  const [detailsCollapsed, setDetailsCollapsedState] = useState(() => getDetailsCollapsed())

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

  const repoRef = useRef(repo)
  useEffect(() => {
    repoRef.current = repo
  }, [repo])

  const paneRef = useRef(pane)
  useEffect(() => {
    paneRef.current = pane
  }, [pane])

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
      setFlowchartState(null)
      // At or below the threshold: everything expanded and selected,
      // identical to this app's pre-collapse, pre-selection behavior.
      // Above it: nothing expanded and nothing selected -- the canvas
      // starts empty (see showEmptySelectionPlaceholder below) rather than
      // rendering every top-level directory/file the user never asked for.
      // Two different sets, not one: only directory/file nodes are real
      // "containers" with children to roll up (collapseDirectories.ts's
      // own concept), but every root-level node -- including a `table`/
      // `dbt_model` node, which has no `defines` parent either -- needs
      // to start selected, or Milestone 17's own data would silently
      // never appear on a freshly-loaded repo without the user manually
      // finding and checking it in the sidebar.
      const underThreshold = parseResult.node_count <= LARGE_GRAPH_NODE_THRESHOLD
      const defaultExpandedContainerIds = underThreshold
        ? new Set(
            graph.nodes
              .filter((node) => node.kind === 'directory' || node.kind === 'file')
              .map((node) => node.id),
          )
        : new Set<string>()
      const defaultSelectedRootIds = underThreshold
        ? rootNodeIds(graph.nodes, graph.edges)
        : new Set<string>()
      setExpandedContainerIds(defaultExpandedContainerIds)
      setSelectedRootIds(defaultSelectedRootIds)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

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

  // Rolls up any directory/file not in `expandedContainerIds` into a
  // single node, so a large repo's worker-side `dagre.layout()` call only
  // ever has to lay out what's actually visible -- see
  // docs/PERFORMANCE-REPORT.md's Iteration 2 for why this is the fix for
  // "large repos stay slow to actually render" (Iteration 1 only fixed
  // the tab-freezing symptom). Referentially stable for the same reason
  // `codebaseGraph` is: this only changes identity when `codebaseGraph`
  // or `expandedContainerIds` themselves do (load, toggle, expand-all/
  // collapse-all, or selecting a node buried inside a collapsed
  // container -- see handleSelectNode), never on unrelated re-renders, so
  // it doesn't spuriously re-trigger `useLayoutWorker`.
  // Restricts `codebaseGraph` down to exactly what the user has checked in
  // the sidebar (plus everything defined inside it) before `collapseGraph`
  // ever runs -- see `subgraphForSelection`'s own doc comment for why a
  // selected id whose parent wasn't also selected still surfaces as a
  // canvas root with no extra logic needed in `collapseGraph` itself.
  // Same referential-stability discipline as `collapsedCodebaseGraph`
  // below: only changes identity when `codebaseGraph`/`selectedRootIds`
  // themselves change, never on an unrelated re-render or autosave tick.
  const selectionFilteredGraph = useMemo(
    () => subgraphForSelection(codebaseGraph.nodes, codebaseGraph.edges, selectedRootIds),
    [codebaseGraph, selectedRootIds],
  )

  const collapsedCodebaseGraph = useMemo(
    () => collapseGraph(selectionFilteredGraph.nodes, selectionFilteredGraph.edges, expandedContainerIds),
    [selectionFilteredGraph, expandedContainerIds],
  )

  // Ids currently rendered as their own box on the codebase canvas --
  // read (not written) inside `handleSelectNode`, via a ref for the same
  // stable-identity reason as `repoRef`/`paneRef` above.
  const visibleNodeIdsRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    visibleNodeIdsRef.current = new Set(collapsedCodebaseGraph.nodes.map((node) => node.id))
  }, [collapsedCodebaseGraph])

  const handleToggleContainer = useCallback((containerId: string) => {
    setExpandedContainerIds((prev) => {
      const next = new Set(prev)
      if (next.has(containerId)) next.delete(containerId)
      else next.add(containerId)
      return next
    })
  }, [])

  const handleToggleRootSelection = useCallback((rootId: string) => {
    setSelectedRootIds((prev) => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }, [])

  const handleResetSelection = useCallback(() => setSelectedRootIds(new Set()), [])

  const handleExpandAll = useCallback(() => {
    if (!repo) return
    setExpandedContainerIds(
      new Set(
        repo.nodes.filter((node) => node.kind === 'directory' || node.kind === 'file').map((node) => node.id),
      ),
    )
  }, [repo])

  const handleCollapseAll = useCallback(() => setExpandedContainerIds(new Set()), [])

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
    return {
      nodes: layout.nodes.map((node) => {
        const saved = repo.positions[node.id]
        return saved ? { ...node, position: { x: saved.x, y: saved.y } } : node
      }),
      edges: layout.edges,
    }
  }, [layout, repo])

  const handleViewSource = useCallback(
    async (nodeId: string) => {
      if (!repo) return
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
      const label = repo.nodes.find((node) => node.id === nodeId)?.label ?? nodeId
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

  // Toggling this off is just clearing the pane -- `complexityByNodeId`
  // below is derived from `pane`, so the heatmap and this pane always
  // stay in sync with no separate on/off state to fall out of sync with.
  const handleToggleComplexity = useCallback(async () => {
    if (!repo) return
    if (pane?.kind === 'complexity') {
      setPane(null)
      return
    }
    cancelGeneration()
    setPane({ kind: 'complexity', status: 'loading' })
    try {
      const result = await getComplexity(repo.path)
      // Bail if something else -- closing this pane, opening a different
      // one, loading a different repo -- has moved on since this fetch
      // started. Applying a stale response here could resurrect a pane
      // the user already dismissed, or worse, attach one repo's scores to
      // a graph that's since switched to a different repo (`paneRef`
      // reflects the latest `pane`, not the one this closure captured).
      if (paneRef.current?.kind !== 'complexity' || paneRef.current.status !== 'loading') return
      setPane({ kind: 'complexity', status: 'loaded', scores: result.scores })
    } catch (error) {
      if (paneRef.current?.kind !== 'complexity' || paneRef.current.status !== 'loading') return
      setPane({ kind: 'complexity', status: 'error', message: errorMessage(error) })
    }
  }, [repo, pane, cancelGeneration])

  const complexityByNodeId = useMemo(() => {
    if (pane?.kind !== 'complexity' || pane.status !== 'loaded') return null
    return new Map<string, ComplexityScore>(pane.scores.map((score) => [score.node_id, score]))
  }, [pane])

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
        setSelectedRootIds((prev) => new Set([...prev, ...newlyIngestedRootIds]))
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
      // selected as a canvas root at all.
      //
      // This used to unconditionally force-expand *every* container
      // ancestor (`ancestorContainerIds`, nearest to outermost) so the
      // node bubbled up into view. That was wrong: `expandedContainerIds`
      // is a per-container all-or-nothing toggle -- expanding one reveals
      // *every* immediate child, not just the one on the path to the
      // selected node. Confirmed live against a real large repo: selecting
      // one small nested directory force-expanded its parent and dumped
      // all ~30 of its siblings onto the canvas, and selecting a single
      // file did the same to every other file in the same directory --
      // there was no way to look at just the thing you clicked, even
      // though nothing about that outer directory was ever selected.
      //
      // The fix distinguishes two cases, walking `nodeId`'s container
      // ancestors nearest-first:
      //
      //  1. Already visible as its own box right now (in
      //     `visibleNodeIdsRef`, which mirrors `collapsedCodebaseGraph`) --
      //     a true no-op, so a plain click on an already-shown node (by
      //     far the most common case: opening its context menu, jumping
      //     to a caller already on screen) never triggers a selection
      //     recompute/relayout.
      //  2. Not visible, but some ancestor already IS visible as its own
      //     box (the user deliberately made *that* container visible,
      //     however it got there) -- expand only the containers from
      //     `nodeId` up to (and including) that nearest visible ancestor.
      //     This reveals exactly the path down from a box the user
      //     already has on screen, same as clicking its chevron would,
      //     with no unrelated siblings further out ever touched.
      //  3. No ancestor is visible at all -- nothing on the path to
      //     `nodeId` was ever selected, so don't expand anything. Add
      //     `nodeId` itself directly to `selectedRootIds` instead:
      //     `subgraphForSelection` already handles a selected id whose
      //     real parent isn't also selected (no surviving parent edge in
      //     the filtered graph), so `collapseGraph`'s own "no parent ->
      //     always a visible root" rule renders it as its own standalone
      //     box -- one new box, nothing swept in around it.
      const visibleIds = visibleNodeIdsRef.current
      if (visibleIds.has(nodeId)) return

      const current = repoRef.current
      if (!current) return
      const ancestors = ancestorContainerIds(nodeId, current.nodes, current.edges)
      const visibleAncestorIndex = ancestors.findIndex((id) => visibleIds.has(id))

      if (visibleAncestorIndex === -1) {
        setSelectedRootIds((prev) => new Set(prev).add(nodeId))
        return
      }
      const toExpand = ancestors.slice(0, visibleAncestorIndex + 1)
      setExpandedContainerIds((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const id of toExpand) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    },
    [cancelGeneration],
  )

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

  const showEmptySelectionPlaceholder = repo !== null && view === 'codebase' && selectedRootIds.size === 0

  const lastRepoPath = getLastRepoPath()
  const rememberedDocRoot = lastRepoPath ? getRememberedDocRoot(lastRepoPath) : null
  const rememberedLanguage = lastRepoPath ? getRememberedLanguage(lastRepoPath) : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0f172a',
        color: '#f8fafc',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <header style={{ padding: 12, borderBottom: '1px solid #1e293b' }}>
        <RepoLoader
          onLoad={handleLoad}
          loading={loading}
          error={loadError}
          initialPath={lastRepoPath ?? undefined}
          initialDocRoot={rememberedDocRoot ?? undefined}
          initialLanguage={rememberedLanguage ?? undefined}
          resolvedDocRoot={repo?.docRoot ?? null}
          hasLoadedRepo={repo !== null}
          onChangeDocRoot={handleChangeDocRoot}
          stats={
            repo
              ? {
                  path: repo.path,
                  nodeCount: repo.nodeCount,
                  edgeCount: repo.edgeCount,
                  parseErrors: repo.parseErrors,
                }
              : null
          }
        />
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {repo && (
          <Sidebar
            nodes={repo.nodes}
            edges={repo.edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            view={view}
            onViewChange={setView}
            complexityActive={pane?.kind === 'complexity'}
            onToggleComplexity={handleToggleComplexity}
            dataSourceActive={pane?.kind === 'dataSource'}
            onToggleDataSource={handleToggleDataSource}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            selectedRootIds={selectedRootIds}
            onToggleRootSelection={handleToggleRootSelection}
            onResetSelection={handleResetSelection}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        )}
        <main style={{ flex: 1, minWidth: 0 }}>
          {!repo && !flowchartState && (
            <div style={{ padding: 24, color: '#94a3b8' }}>
              Load a repository to see its codebase graph.
            </div>
          )}
          {repo && !flowchartState && showFileViewPlaceholder && (
            <div style={{ padding: 24, color: '#94a3b8' }}>
              Select a file, class, or function to see its file view.
            </div>
          )}
          {repo && !flowchartState && !showFileViewPlaceholder && showEmptySelectionPlaceholder && (
            <div style={{ padding: 24, color: '#94a3b8' }}>
              Select a directory or file in the sidebar to add it to the canvas.
            </div>
          )}
          {repo &&
            !flowchartState &&
            !showFileViewPlaceholder &&
            !showEmptySelectionPlaceholder &&
            (layout.status === 'idle' || layout.status === 'laying-out') && (
              <div style={{ padding: 24, color: '#94a3b8' }}>
                Laying out {scopedGraph.nodes.length} nodes…
              </div>
            )}
          {repo &&
            !flowchartState &&
            !showFileViewPlaceholder &&
            !showEmptySelectionPlaceholder &&
            layout.status === 'error' && (
              <div style={{ padding: 24 }}>
                <span role="alert" style={{ color: '#fca5a5' }}>
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
                onAutoSavePositions={handleAutoSavePositions}
                highlight={impactHighlight}
                complexityByNodeId={complexityByNodeId}
              />
            )}
          {flowchartState?.status === 'loading' && (
            <div style={{ padding: 24, color: '#94a3b8' }}>Loading flowchart…</div>
          )}
          {flowchartState?.status === 'error' && (
            <div style={{ padding: 24 }}>
              <span role="alert" style={{ color: '#fca5a5' }}>
                {flowchartState.message}
              </span>
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={handleBackToGraph}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 4,
                    color: '#f8fafc',
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
          collapsed={detailsCollapsed}
          onToggleCollapsed={toggleDetailsCollapsed}
        />
      </div>
    </div>
  )
}
