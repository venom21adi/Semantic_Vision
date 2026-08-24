import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NodeKind } from '../api/types'

export interface GraphNodeData extends Record<string, unknown> {
  label: string
  kind: NodeKind
  file: string
  lineStart: number
  lineEnd: number
  /** Set only while the complexity heatmap is on, and only for `function`
   * nodes (the only kind with a complexity score) -- overrides the
   * kind-based background below rather than replacing it, so turning the
   * heatmap off just means this stops being set. */
  heatmapColor?: string
}

export const KIND_COLORS: Record<NodeKind, { background: string; border: string }> = {
  directory: { background: '#1d4ed8', border: '#93c5fd' },
  file: { background: '#15803d', border: '#86efac' },
  class: { background: '#7e22ce', border: '#d8b4fe' },
  function: { background: '#c2410c', border: '#fdba74' },
}

function GraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as GraphNodeData
  const colors = KIND_COLORS[nodeData.kind]

  return (
    <div
      title={nodeData.label}
      style={{
        background: nodeData.heatmapColor ?? colors.background,
        border: `2px solid ${selected ? '#f8fafc' : colors.border}`,
        borderRadius: 6,
        padding: '6px 12px',
        color: '#f8fafc',
        fontSize: 12,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        minWidth: 120,
        maxWidth: 220,
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textAlign: 'center',
        boxShadow: selected ? '0 0 0 2px #f8fafc' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export const nodeTypes = {
  directory: GraphNodeComponent,
  file: GraphNodeComponent,
  class: GraphNodeComponent,
  function: GraphNodeComponent,
}
