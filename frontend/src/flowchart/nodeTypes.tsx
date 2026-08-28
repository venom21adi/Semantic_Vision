import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { FlowNodeKind } from '../api/types'
import { colors as themeColors, font } from '../theme'

export interface FlowNodeData extends Record<string, unknown> {
  label: string
  kind: FlowNodeKind
  line: number
  endLine: number
}

/** OKLCH, same recipe as `graph/nodeTypes.tsx`'s `KIND_COLORS` (background:
 * L .42 C .15; border: L .74 C .12), and the same reason: `loop` was
 * previously `#3730a3`, an indigo landing on theme.ts's `colors.accent`
 * hue (291) -- a loop node and "this is selected/interactive" read as the
 * same color family. `entry`/`return`/`decision`/`call` reuse theme.ts's
 * own semantic hues (success/danger/warning/info) where the meaning
 * actually matches (start reads as success-green, return as danger-red,
 * branch as warning-amber, a call as info-blue) rather than picking a
 * fifth arbitrary hue family; `statement` stays a low-chroma neutral
 * (the "plain, unremarkable" default case, distinct from the others by
 * being colorless rather than by hue); `loop`/`io` get new hues, chosen
 * outside 266-316 and spaced from every hue above. */
const FLOW_KIND_COLORS: Record<FlowNodeKind, { background: string; border: string }> = {
  entry: { background: 'oklch(0.42 0.15 152)', border: 'oklch(0.74 0.12 152)' },
  return: { background: 'oklch(0.42 0.15 25)', border: 'oklch(0.74 0.12 25)' },
  statement: { background: 'oklch(0.33 0.012 265)', border: 'oklch(0.58 0.013 265)' },
  call: { background: 'oklch(0.42 0.15 230)', border: 'oklch(0.74 0.12 230)' },
  decision: { background: 'oklch(0.42 0.15 80)', border: 'oklch(0.74 0.12 80)' },
  loop: { background: 'oklch(0.42 0.15 350)', border: 'oklch(0.74 0.12 350)' },
  io: { background: 'oklch(0.42 0.15 116)', border: 'oklch(0.74 0.12 116)' },
}

function tooltip(data: FlowNodeData): string {
  return data.endLine > data.line ? `Lines ${data.line}–${data.endLine}` : `Line ${data.line}`
}

const BASE_TEXT_STYLE = {
  color: themeColors.textPrimary,
  fontSize: 12,
  fontFamily: font.ui,
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
        border: `2px solid ${selected ? themeColors.textPrimary : colors.border}`,
        borderRadius: 6,
        padding: '6px 12px',
        minWidth: 120,
        maxWidth: 220,
        boxShadow: selected ? `0 0 0 2px ${themeColors.textPrimary}` : 'none',
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
        border: `2px solid ${selected ? themeColors.textPrimary : colors.border}`,
        borderRadius: 999,
        padding: '6px 16px',
        minWidth: 120,
        maxWidth: 220,
        boxShadow: selected ? `0 0 0 2px ${themeColors.textPrimary}` : 'none',
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
        border: `2px solid ${selected ? themeColors.textPrimary : colors.border}`,
        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        padding: '14px 28px',
        minWidth: 160,
        maxWidth: 260,
        boxShadow: selected ? `0 0 0 2px ${themeColors.textPrimary}` : 'none',
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
        border: `2px solid ${selected ? themeColors.textPrimary : colors.border}`,
        clipPath: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
        padding: '8px 24px',
        minWidth: 140,
        maxWidth: 240,
        boxShadow: selected ? `0 0 0 2px ${themeColors.textPrimary}` : 'none',
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
        border: `2px solid ${selected ? themeColors.textPrimary : colors.border}`,
        borderRadius: 4,
        padding: '6px 18px',
        minWidth: 130,
        maxWidth: 230,
        boxShadow: selected ? `0 0 0 2px ${themeColors.textPrimary}` : 'none',
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
