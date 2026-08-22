import { useCallback, useMemo, useState } from 'react'
import { ApiError, getFunctionSource, getGraph, parseRepo } from './api/client'
import type { GraphNode, ParseErrorInfo } from './api/types'
import { DetailsPanel, type ActivePane } from './components/DetailsPanel'
import { RepoLoader } from './components/RepoLoader'
import { GraphCanvas } from './graph/GraphCanvas'
import { buildFlowGraph } from './graph/transform'

interface LoadedRepo {
  path: string
  nodes: GraphNode[]
  edges: import('./api/types').GraphEdge[]
  nodeCount: number
  edgeCount: number
  parseErrors: ParseErrorInfo[]
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

  const handleLoad = useCallback(async (path: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const parseResult = await parseRepo(path)
      const graph = await getGraph(parseResult.path)
      setRepo({
        path: parseResult.path,
        nodes: graph.nodes,
        edges: graph.edges,
        nodeCount: parseResult.node_count,
        edgeCount: parseResult.edge_count,
        parseErrors: parseResult.parse_errors,
      })
      setSelectedNodeId(null)
      setPane(null)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const flowGraph = useMemo(
    () => (repo ? buildFlowGraph(repo.nodes, repo.edges) : { nodes: [], edges: [] }),
    [repo],
  )

  const selectedNode = useMemo(
    () => repo?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [repo, selectedNodeId],
  )

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

  const handleDocument = useCallback((_nodeId: string) => {
    setPane({ kind: 'stub', feature: 'Document' })
  }, [])

  const handleImpactAnalysis = useCallback((_nodeId: string) => {
    setPane({ kind: 'stub', feature: 'Impact Analysis' })
  }, [])

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
        <RepoLoader onLoad={handleLoad} loading={loading} error={loadError} />
        {repo && (
          <p data-testid="repo-status" style={{ margin: '8px 0 0', fontSize: 12, color: '#94a3b8' }}>
            {repo.path} — {repo.nodeCount} nodes, {repo.edgeCount} edges
            {repo.parseErrors.length > 0 && `, ${repo.parseErrors.length} parse errors`}
          </p>
        )}
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <main style={{ flex: 1, minWidth: 0 }}>
          {repo ? (
            <GraphCanvas
              key={repo.path}
              nodes={flowGraph.nodes}
              edges={flowGraph.edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onDocument={handleDocument}
              onImpactAnalysis={handleImpactAnalysis}
              onViewSource={handleViewSource}
            />
          ) : (
            <div style={{ padding: 24, color: '#94a3b8' }}>
              Load a repository to see its codebase graph.
            </div>
          )}
        </main>
        <DetailsPanel selectedNode={selectedNode} pane={pane} />
      </div>
    </div>
  )
}
