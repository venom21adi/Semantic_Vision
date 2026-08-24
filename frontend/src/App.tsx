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
import { GraphCanvas, type GraphHighlight } from './graph/GraphCanvas'
import { scopeToFile } from './graph/transform'
import { useLayoutWorker } from './graph/useLayoutWorker'
import {
  dismissDocSaveNotice,
  getDetailsCollapsed,
  getLastRepoPath,
  getRememberedDocRoot,
  getSidebarCollapsed,
  isDocSaveNoticeDismissed,
  setDetailsCollapsed,
  setLastRepoPath,
  setRememberedDocRoot,
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

  const handleLoad = useCallback(async (path: string, docRoot: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const parseResult = await parseRepo(path, docRoot || undefined)
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
      setSelectedNodeId(null)
      setPane(null)
      setView('codebase')
      setFlowchartState(null)
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

  const scopedGraph = view === 'file' && fileScopedGraph ? fileScopedGraph : codebaseGraph

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

  // Clicking empty canvas space already deselects (calls this with
  // `null`); it also clears the active pane, so an Impact
  // Analysis/Document/Source pane -- and the graph highlighting that
  // comes with it -- has an obvious way out instead of staying stuck
  // until some other context-menu action happens to replace it.
  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      cancelGeneration()
      setSelectedNodeId(nodeId)
      if (nodeId === null) setPane(null)
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

  const lastRepoPath = getLastRepoPath()
  const rememberedDocRoot = lastRepoPath ? getRememberedDocRoot(lastRepoPath) : null

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
          {repo &&
            !flowchartState &&
            !showFileViewPlaceholder &&
            (layout.status === 'idle' || layout.status === 'laying-out') && (
              <div style={{ padding: 24, color: '#94a3b8' }}>
                Laying out {scopedGraph.nodes.length} nodes…
              </div>
            )}
          {repo && !flowchartState && !showFileViewPlaceholder && layout.status === 'error' && (
            <div style={{ padding: 24 }}>
              <span role="alert" style={{ color: '#fca5a5' }}>
                Failed to lay out the graph. Try switching views or reloading the repository.
              </span>
            </div>
          )}
          {repo && !flowchartState && !showFileViewPlaceholder && layout.status === 'ready' && (
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
          onSelectCaller={setSelectedNodeId}
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
          collapsed={detailsCollapsed}
          onToggleCollapsed={toggleDetailsCollapsed}
        />
      </div>
    </div>
  )
}
