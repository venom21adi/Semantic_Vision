import { useCallback, useEffect, useRef, useState } from 'react'
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
}: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const { fitView } = useReactFlow()
  const nodesRef = useRef(nodes)

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

  // Keeps canvas selection in sync when it's driven from elsewhere (e.g. a
  // future sidebar/tree selection), not just from clicks on the canvas.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) =>
        node.selected === (node.id === selectedNodeId)
          ? node
          : { ...node, selected: node.id === selectedNodeId },
      ),
    )
  }, [selectedNodeId, setNodes])

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

  const isLargeGraph = nodes.length > LARGE_GRAPH_NODE_THRESHOLD

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
          Large graph: {nodes.length} nodes. Rendering may be slow.
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
