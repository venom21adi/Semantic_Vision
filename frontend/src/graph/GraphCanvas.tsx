import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { NodePosition } from '../api/types'
import { ContextMenu, type ContextMenuTarget } from './ContextMenu'
import { nodeTypes, type GraphNodeData } from './nodeTypes'
import { neighborNodeIds } from './transform'

export const LARGE_GRAPH_NODE_THRESHOLD = 300
export const AUTO_SAVE_POSITIONS_INTERVAL_MS = 60_000
const DIMMED_NODE_OPACITY = 0.25
const DIMMED_EDGE_OPACITY = 0.1

export interface GraphHighlight {
  nodeIds: ReadonlySet<string>
  /** Keys of the form `${source}->${target}`, matching each edge's own
   * source/target ids (kind-independent, since a highlighted chain is
   * always a `calls` chain in practice). */
  edgeKeys: ReadonlySet<string>
}

export interface GraphCanvasProps {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onDocument: (nodeId: string) => void
  onImpactAnalysis: (nodeId: string) => void
  onViewSource: (nodeId: string) => void
  /** Called every `AUTO_SAVE_POSITIONS_INTERVAL_MS` with the current node
   * positions (including any the user has dragged), so a moved layout
   * survives a reload. Omit to disable auto-save. */
  onAutoSavePositions?: (positions: Record<string, NodePosition>) => void
  /** When set, dims every node/edge not part of it (e.g. an impact
   * analysis caller chain) instead of resetting the canvas to just that
   * subset -- so the rest of the graph stays visible for context. */
  highlight?: GraphHighlight | null
}

function GraphCanvasInner({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId,
  onSelectNode,
  onDocument,
  onImpactAnalysis,
  onViewSource,
  onAutoSavePositions,
  highlight,
}: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const { fitView } = useReactFlow()
  const nodesRef = useRef(nodes)

  // The edges' own base style (color, dash pattern, external/ambiguous
  // dimming) comes from `initialEdges` and must survive highlighting --
  // restoring it exactly once a highlight clears, not just resetting to
  // opacity 1.
  const baseEdgeStyleById = useMemo(() => {
    const map = new Map<string, Edge['style']>()
    for (const edge of initialEdges) map.set(edge.id, edge.style)
    return map
  }, [initialEdges])

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    if (!onAutoSavePositions) return
    const flush = () => {
      const positions: Record<string, NodePosition> = {}
      for (const node of nodesRef.current) {
        positions[node.id] = { x: node.position.x, y: node.position.y }
      }
      onAutoSavePositions(positions)
    }
    const interval = setInterval(flush, AUTO_SAVE_POSITIONS_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      // Flushes whatever's been dragged since the last tick before this
      // canvas unmounts/remounts (e.g. switching the Codebase/File view),
      // so a drag made just before that isn't silently lost.
      flush()
    }
  }, [onAutoSavePositions])

  // Selection and highlight are rendered as a pure derivation of the raw
  // `nodes`/`edges` state, `selectedNodeId`, and `highlight` -- not as
  // effects that mutate that state -- so they can never fall out of sync
  // with it (e.g. an unrelated prop change resetting `nodes` via the
  // resync effect above, which would otherwise silently wipe an
  // already-applied `selected`/highlight style until *that* prop next
  // changes, since an effect only reruns when its own deps change).
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const selected = node.id === selectedNodeId
        const opacity = !highlight ? 1 : highlight.nodeIds.has(node.id) ? 1 : DIMMED_NODE_OPACITY
        if (node.selected === selected && node.style?.opacity === opacity) return node
        return { ...node, selected, style: { ...node.style, opacity } }
      }),
    [nodes, selectedNodeId, highlight],
  )

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const baseStyle = baseEdgeStyleById.get(edge.id)
        const key = `${edge.source}->${edge.target}`
        const opacity = !highlight
          ? (baseStyle?.opacity ?? 1)
          : highlight.edgeKeys.has(key)
            ? 1
            : DIMMED_EDGE_OPACITY
        if (edge.style?.opacity === opacity) return edge
        return { ...edge, style: { ...baseStyle, opacity } }
      }),
    [edges, highlight, baseEdgeStyleById],
  )

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onSelectNode(node.id)
    },
    [onSelectNode],
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handlePaneClick = useCallback(() => {
    onSelectNode(null)
    closeContextMenu()
  }, [onSelectNode, closeContextMenu])

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const neighborIds = neighborNodeIds(node.id, initialEdges)
      void fitView({ nodes: neighborIds.map((id) => ({ id })), duration: 300, padding: 0.3 })
    },
    [fitView, initialEdges],
  )

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      onSelectNode(node.id)
      setContextMenu({
        nodeId: node.id,
        label: (node.data as GraphNodeData).label,
        x: event.clientX,
        y: event.clientY,
      })
    },
    [onSelectNode],
  )

  const isLargeGraph = displayNodes.length > LARGE_GRAPH_NODE_THRESHOLD

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isLargeGraph && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: '#7c2d12',
            color: '#fed7aa',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Large graph: {displayNodes.length} nodes. Rendering may be slow.
        </div>
      )}
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={handlePaneClick}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {contextMenu && (
        <ContextMenu
          target={contextMenu}
          onClose={closeContextMenu}
          onDocument={onDocument}
          onImpactAnalysis={onImpactAnalysis}
          onViewSource={onViewSource}
        />
      )}
    </div>
  )
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
