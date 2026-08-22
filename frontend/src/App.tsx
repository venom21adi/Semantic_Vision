import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  getDoc,
  getFunctionSource,
  getGraph,
  getGraphState,
  parseRepo,
  saveGraphState,
} from './api/client'
import type { GraphEdge, GraphNode, NodePosition, ParseErrorInfo } from './api/types'
import { DetailsPanel, type ActivePane } from './components/DetailsPanel'
import { RepoLoader } from './components/RepoLoader'
import { Sidebar, type GraphView } from './components/Sidebar'
import { GraphCanvas } from './graph/GraphCanvas'
import { buildFlowGraph, scopeToFile } from './graph/transform'
import { getLastRepoPath, setLastRepoPath } from './utils/localStorage'

interface LoadedRepo {
  path: string
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

export default function App() {
  const [repo, setRepo] = useState<LoadedRepo | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [pane, setPane] = useState<ActivePane>(null)
  const [view, setView] = useState<GraphView>('codebase')

  const repoRef = useRef(repo)
  useEffect(() => {
    repoRef.current = repo
  }, [repo])

  const handleLoad = useCallback(async (path: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const parseResult = await parseRepo(path)
      const [graph, graphState] = await Promise.all([
        getGraph(parseResult.path),
        getGraphState(parseResult.path),
      ])
      setRepo({
        path: parseResult.path,
        nodes: graph.nodes,
        edges: graph.edges,
        nodeCount: parseResult.node_count,
        edgeCount: parseResult.edge_count,
        parseErrors: parseResult.parse_errors,
        positions: graphState.positions,
      })
      setLastRepoPath(path)
      setSelectedNodeId(null)
      setPane(null)
      setView('codebase')
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const selectedNode = useMemo(
    () => repo?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [repo, selectedNodeId],
  )

  const scopedGraph = useMemo(() => {
    if (!repo) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] }
    if (view === 'file' && selectedNode && selectedNode.kind !== 'directory') {
      return scopeToFile(repo.nodes, repo.edges, selectedNode.file)
    }
    return { nodes: repo.nodes, edges: repo.edges }
  }, [repo, view, selectedNode])

  const flowGraph = useMemo(() => {
    const built = buildFlowGraph(scopedGraph.nodes, scopedGraph.edges)
    if (!repo || Object.keys(repo.positions).length === 0) return built
    return {
      ...built,
      nodes: built.nodes.map((node) => {
        const saved = repo.positions[node.id]
        return saved ? { ...node, position: { x: saved.x, y: saved.y } } : node
      }),
    }
  }, [scopedGraph, repo])

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
      setPane({ kind: 'doc', status: 'loading' })
      try {
        const result = await getDoc(repo.path, nodeId)
        setPane({ kind: 'doc', status: 'loaded', markdown: result.markdown })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setPane({ kind: 'doc', status: 'not-found' })
        } else {
          setPane({ kind: 'doc', status: 'error', message: errorMessage(error) })
        }
      }
    },
    [repo],
  )

  const handleImpactAnalysis = useCallback((_nodeId: string) => {
    setPane({ kind: 'stub', feature: 'Impact Analysis' })
  }, [])

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
          initialPath={getLastRepoPath() ?? undefined}
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
            onSelectNode={setSelectedNodeId}
            view={view}
            onViewChange={setView}
          />
        )}
        <main style={{ flex: 1, minWidth: 0 }}>
          {!repo && (
            <div style={{ padding: 24, color: '#94a3b8' }}>
              Load a repository to see its codebase graph.
            </div>
          )}
          {showFileViewPlaceholder && (
            <div style={{ padding: 24, color: '#94a3b8' }}>
              Select a file, class, or function to see its file view.
            </div>
          )}
          {repo && !showFileViewPlaceholder && (
            <GraphCanvas
              key={`${repo.path}:${view}:${view === 'file' ? selectedNode?.file : ''}`}
              nodes={flowGraph.nodes}
              edges={flowGraph.edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onDocument={handleDocument}
              onImpactAnalysis={handleImpactAnalysis}
              onViewSource={handleViewSource}
              onAutoSavePositions={handleAutoSavePositions}
            />
          )}
        </main>
        <DetailsPanel selectedNode={selectedNode} pane={pane} />
      </div>
    </div>
  )
}
