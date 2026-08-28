import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NodeKind } from '../api/types'
import { colors as themeColors } from '../theme'
import { formatNodeLabel } from './accessorLabel'

export interface GraphNodeData extends Record<string, unknown> {
  label: string
  kind: NodeKind
  file: string
  lineStart: number
  lineEnd: number
  /** JS/TS getter/setter marker -- see `accessorLabel.ts`. `undefined`
   * for every node that isn't a getter/setter. */
  accessorKind?: 'get' | 'set' | null
  /** Set only while the complexity heatmap is on, and only for `function`
   * nodes (the only kind with a complexity score) -- overrides the
   * kind-based background below rather than replacing it, so turning the
   * heatmap off just means this stops being set. */
  heatmapColor?: string
  /** Directory/file nodes only -- whether this container's own children
   * are currently shown as separate nodes (`true`) or rolled up into this
   * one (`false`). Undefined for non-container kinds and for a container
   * with no `defines` children at all (nothing to expand). */
  isExpanded?: boolean
  /** Directory/file nodes only -- how many descendants (at any depth) are
   * currently rolled up into this node. 0 or undefined when expanded or
   * when there's nothing hidden. */
  hiddenDescendantCount?: number
}

export const KIND_COLORS: Record<NodeKind, { background: string; border: string }> = {
  directory: { background: '#1d4ed8', border: '#93c5fd' },
  file: { background: '#15803d', border: '#86efac' },
  class: { background: '#7e22ce', border: '#d8b4fe' },
  function: { background: '#c2410c', border: '#fdba74' },
  table: { background: '#0e7490', border: '#67e8f9' },
  dbt_model: { background: '#a16207', border: '#fde047' },
}

function GraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as GraphNodeData
  const colors = KIND_COLORS[nodeData.kind]
  // A directory/file with nothing rolled up shows no chevron at all --
  // there's nothing to expand/collapse, whether or not it's nominally
  // "expanded".
  const chevron =
    nodeData.kind !== 'directory' && nodeData.kind !== 'file'
      ? null
      : nodeData.hiddenDescendantCount
        ? '▸ '
        : nodeData.isExpanded
          ? '▾ '
          : null

  const displayLabel = formatNodeLabel(nodeData.label, nodeData.accessorKind)

  return (
    <div
      title={displayLabel}
      style={{
        background: nodeData.heatmapColor ?? colors.background,
        border: `2px solid ${selected ? themeColors.textPrimary : colors.border}`,
        borderRadius: 6,
        padding: '6px 12px',
        color: themeColors.textPrimary,
        fontSize: 12,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        minWidth: 120,
        maxWidth: 220,
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textAlign: 'center',
        boxShadow: selected ? `0 0 0 2px ${themeColors.textPrimary}` : 'none',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {chevron && (
        // The only click target that toggles expand/collapse -- see
        // `GraphCanvas.tsx`'s `handleNodeClick`, which inspects the click
        // event's target for this attribute. Everywhere else on the node
        // still selects it, same as any other kind (a file has real
        // click behavior -- View Source, Document, etc. -- worth keeping
        // on a plain click).
        <span data-node-toggle="true" style={{ cursor: 'pointer' }}>
          {chevron}
        </span>
      )}
      {displayLabel}
      {nodeData.hiddenDescendantCount ? ` (${nodeData.hiddenDescendantCount})` : ''}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export const nodeTypes = {
  directory: GraphNodeComponent,
  file: GraphNodeComponent,
  class: GraphNodeComponent,
  function: GraphNodeComponent,
  table: GraphNodeComponent,
  dbt_model: GraphNodeComponent,
}
