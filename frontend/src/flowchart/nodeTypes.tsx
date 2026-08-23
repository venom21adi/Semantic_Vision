import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { FlowNodeKind } from '../api/types'

export interface FlowNodeData extends Record<string, unknown> {
  label: string
  kind: FlowNodeKind
  line: number
  endLine: number
}

const FLOW_KIND_COLORS: Record<FlowNodeKind, { background: string; border: string }> = {
  entry: { background: '#065f46', border: '#34d399' },
  return: { background: '#7f1d1d', border: '#fca5a5' },
  statement: { background: '#334155', border: '#94a3b8' },
  call: { background: '#164e63', border: '#67e8f9' },
  decision: { background: '#854d0e', border: '#fde047' },
  loop: { background: '#3730a3', border: '#a5b4fc' },
  io: { background: '#701a75', border: '#e9d5ff' },
}

function tooltip(data: FlowNodeData): string {
  return data.endLine > data.line ? `Lines ${data.line}–${data.endLine}` : `Line ${data.line}`
}

const BASE_TEXT_STYLE = {
  color: '#f8fafc',
  fontSize: 12,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  textAlign: 'center' as const,
  textOverflow: 'ellipsis' as const,
  overflow: 'hidden' as const,
  whiteSpace: 'nowrap' as const,
}

function StatementNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  const colors = FLOW_KIND_COLORS[nodeData.kind]
  return (
    <div
      title={tooltip(nodeData)}
      style={{
        ...BASE_TEXT_STYLE,
        background: colors.background,
        border: `2px solid ${selected ? '#f8fafc' : colors.border}`,
        borderRadius: 6,
        padding: '6px 12px',
        minWidth: 120,
        maxWidth: 220,
        boxShadow: selected ? '0 0 0 2px #f8fafc' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function StadiumNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  const colors = FLOW_KIND_COLORS[nodeData.kind]
  return (
    <div
      title={tooltip(nodeData)}
      style={{
        ...BASE_TEXT_STYLE,
        background: colors.background,
        border: `2px solid ${selected ? '#f8fafc' : colors.border}`,
        borderRadius: 999,
        padding: '6px 16px',
        minWidth: 120,
        maxWidth: 220,
        boxShadow: selected ? '0 0 0 2px #f8fafc' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function DiamondNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  const colors = FLOW_KIND_COLORS[nodeData.kind]
  return (
    <div
      title={tooltip(nodeData)}
      style={{
        ...BASE_TEXT_STYLE,
        background: colors.background,
        border: `2px solid ${selected ? '#f8fafc' : colors.border}`,
        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        padding: '14px 28px',
        minWidth: 160,
        maxWidth: 260,
        boxShadow: selected ? '0 0 0 2px #f8fafc' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function ParallelogramNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  const colors = FLOW_KIND_COLORS[nodeData.kind]
  return (
    <div
      title={tooltip(nodeData)}
      style={{
        ...BASE_TEXT_STYLE,
        background: colors.background,
        border: `2px solid ${selected ? '#f8fafc' : colors.border}`,
        clipPath: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
        padding: '8px 24px',
        minWidth: 140,
        maxWidth: 240,
        boxShadow: selected ? '0 0 0 2px #f8fafc' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/** The conventional flowchart "predefined process" symbol -- a rectangle
 * with two thin inset vertical bars -- used for calls to functions defined
 * elsewhere in the repo ("sub-process calls"). */
function SubprocessNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData
  const colors = FLOW_KIND_COLORS[nodeData.kind]
  return (
    <div
      title={tooltip(nodeData)}
      style={{
        ...BASE_TEXT_STYLE,
        position: 'relative',
        background: colors.background,
        border: `2px solid ${selected ? '#f8fafc' : colors.border}`,
        borderRadius: 4,
        padding: '6px 18px',
        minWidth: 130,
        maxWidth: 230,
        boxShadow: selected ? '0 0 0 2px #f8fafc' : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        style={{ position: 'absolute', left: 6, top: 2, bottom: 2, width: 2, background: colors.border }}
      />
      {nodeData.label}
      <div
        style={{ position: 'absolute', right: 6, top: 2, bottom: 2, width: 2, background: colors.border }}
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export const flowchartNodeTypes: Record<FlowNodeKind, typeof StatementNode> = {
  entry: StadiumNode,
  return: StadiumNode,
  statement: StatementNode,
  call: SubprocessNode,
  decision: DiamondNode,
  loop: DiamondNode,
  io: ParallelogramNode,
}
