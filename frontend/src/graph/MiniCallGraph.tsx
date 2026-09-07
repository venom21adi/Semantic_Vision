import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect } from 'react'
import type { ComplexityScore, GraphEdge, GraphNode } from '../api/types'
import { colors, font } from '../theme'
import { complexityToColor } from './heatmap'
import { layoutGraph } from './layout'

export interface MiniCallGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  scores: ComplexityScore[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

interface MiniGraphNodeData extends Record<string, unknown> {
  label: string
  color: string
  depth: number
}

function MiniGraphNode({ data, selected }: NodeProps) {
  const nodeData = data as MiniGraphNodeData
  return (
    <div
      title={`Call-chain depth ${nodeData.depth}`}
      style={{
        background: nodeData.color,
        border: `2px solid ${selected ? colors.textPrimary : 'transparent'}`,
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 120,
        maxWidth: 220,
        color: colors.textPrimary,
        fontSize: 11,
        fontFamily: font.ui,
        textAlign: 'center',
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        boxShadow: selected ? `0 0 0 2px ${colors.textPrimary}` : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const miniGraphNodeTypes = { default: MiniGraphNode }

function computeFlowNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  scores: ComplexityScore[],
  selectedNodeId: string | null,
): Node<MiniGraphNodeData>[] {
  const scoreById = new Map(scores.map((score) => [score.node_id, score]))
  const nodeIds = new Set(nodes.map((node) => node.id))

  return layoutGraph(
    nodes.map((node) => {
      const score = scoreById.get(node.id)
      return {
        id: node.id,
        type: 'default',
        position: { x: 0, y: 0 },
        selected: node.id === selectedNodeId,
        data: {
          label: node.label,
          color: score ? complexityToColor(score.cyclomatic_complexity) : colors.textDim,
          depth: score?.call_chain_depth ?? 0,
        },
      }
    }),
    edges
      .filter((edge) => edge.kind === 'calls' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({ id: `${edge.source}->${edge.target}`, source: edge.source, target: edge.target })),
    'TB',
  )
}

function computeFlowEdges(nodes: GraphNode[], edges: GraphEdge[]): Edge[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  return edges
    .filter((edge) => edge.kind === 'calls' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      style: { stroke: colors.borderSubtle },
    }))
}

function MiniCallGraphInner({ nodes, edges, scores, selectedNodeId, onSelectNode }: MiniCallGraphProps) {
  const { setCenter, getNode } = useReactFlow<Node<MiniGraphNodeData>>()

  // `useNodesState`/`useEdgesState` + a resync effect, mirroring
  // `GraphCanvas.tsx`'s own established pattern -- a bare `nodes` prop
  // with `nodesDraggable={false}` (no local node-drag state at all)
  // instead causes ReactFlow's pane-level d3-zoom pan/drag handler to
  // pick up the node's own mousedown in jsdom, throwing inside d3-drag's
  // `nodrag.js`. Dragging is left enabled (as GraphCanvas's own tests
  // already exercise safely) rather than fighting that interaction --
  // nothing here persists a dragged position, so it's harmless, and a
  // relayout on the next prop change snaps everything back anyway.
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(
    computeFlowNodes(nodes, edges, scores, selectedNodeId),
  )
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(computeFlowEdges(nodes, edges))

  useEffect(() => {
    setFlowNodes(computeFlowNodes(nodes, edges, scores, selectedNodeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFlowNodes is stable
  }, [nodes, edges, scores, selectedNodeId])

  useEffect(() => {
    setFlowEdges(computeFlowEdges(nodes, edges))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFlowEdges is stable
  }, [nodes, edges])

  // Centers the view on `selectedNodeId` whenever it changes externally
  // (a list-row click elsewhere on the dashboard) -- clicking a node in
  // this graph itself already puts it under the pointer, so no separate
  // centering is needed for that direction.
  useEffect(() => {
    if (!selectedNodeId) return
    const node = getNode(selectedNodeId)
    if (!node) return
    const width = node.measured?.width ?? 172
    const height = node.measured?.height ?? 40
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-center on selection change, not on every relayout
  }, [selectedNodeId])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={miniGraphNodeTypes}
      onNodeClick={(_event, node) => onSelectNode(node.id)}
      fitView
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
    </ReactFlow>
  )
}

/** A small, read-only call-depth graph for the dashboard's split-screen
 * layout -- deliberately not `GraphCanvas`, which carries directory-
 * collapse/context-menu/heatmap-toggle chrome this embedded view doesn't
 * need. Modeled on `flowchart/FlowchartCanvas.tsx`'s much simpler shape
 * instead. Nodes are colored via the same `complexityToColor` the ranked
 * list already uses, so the list and the graph read as one consistent
 * view of the same data, not two independent color languages. */
export function MiniCallGraph(props: MiniCallGraphProps) {
  return (
    <ReactFlowProvider>
      <MiniCallGraphInner {...props} />
    </ReactFlowProvider>
  )
}
