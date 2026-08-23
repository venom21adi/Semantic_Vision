import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { flowchartNodeTypes, type FlowNodeData } from './nodeTypes'

export const LARGE_FLOWCHART_NODE_THRESHOLD = 300

export interface FlowchartCanvasProps {
  targetLabel: string
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
  onBack: () => void
}

function FlowchartCanvasInner({ targetLabel, nodes: initialNodes, edges: initialEdges, onBack }: FlowchartCanvasProps) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  const isLarge = nodes.length > LARGE_FLOWCHART_NODE_THRESHOLD

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid #1e293b',
          background: '#0f172a',
          color: '#f8fafc',
          fontSize: 13,
        }}
      >
        <span>Execution flowchart: {targetLabel}</span>
        <button
          onClick={onBack}
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
      <div style={{ position: 'relative', flex: 1 }}>
        {isLarge && (
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
            Large flowchart: {nodes.length} nodes. Rendering may be slow.
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={flowchartNodeTypes}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  )
}

export function FlowchartCanvas(props: FlowchartCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowchartCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
