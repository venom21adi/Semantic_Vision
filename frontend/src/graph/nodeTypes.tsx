import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NodeKind } from '../api/types'
import { colors as themeColors, font } from '../theme'
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

/** OKLCH, one consistent recipe per tier (background: L .42 C .15;
 * border: L .74 C .12), hue-only varying by kind -- reads as one
 * coordinated categorical palette rather than picked-independently
 * Tailwind swatches (the previous hex values). Hues deliberately avoid
 * 266-316 (theme.ts's `colors.accent` sits at 291): `class` was
 * previously `#7e22ce`, a violet-purple landing almost exactly on the
 * new brand accent's hue -- a node-kind color and "this is
 * selected/interactive" read as the same color family, confirmed
 * against the actual accent value while designing this pass, not
 * assumed. Picked magenta (335) instead, clearly outside that range and
 * still distinct from every other kind here. */
export const KIND_COLORS: Record<NodeKind, { background: string; border: string }> = {
  directory: { background: 'oklch(0.42 0.15 235)', border: 'oklch(0.74 0.12 235)' },
  file: { background: 'oklch(0.42 0.15 150)', border: 'oklch(0.74 0.12 150)' },
  class: { background: 'oklch(0.42 0.15 335)', border: 'oklch(0.74 0.12 335)' },
  function: { background: 'oklch(0.42 0.15 40)', border: 'oklch(0.74 0.12 40)' },
  table: { background: 'oklch(0.42 0.15 195)', border: 'oklch(0.74 0.12 195)' },
  dbt_model: { background: 'oklch(0.42 0.15 95)', border: 'oklch(0.74 0.12 95)' },
  // Same hue as `table` (195), lighter and less saturated -- a column
  // reads as "part of a table," not a sibling kind with equal visual
  // weight, since that's the actual containment relationship between them
  // (a table --DEFINES--> its columns, same as a directory contains files).
  column: { background: 'oklch(0.55 0.08 195)', border: 'oklch(0.80 0.07 195)' },
}

function GraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as GraphNodeData
  const colors = KIND_COLORS[nodeData.kind]
  // A container with nothing rolled up shows no chevron at all -- there's
  // nothing to expand/collapse, whether or not it's nominally "expanded".
  // `table` joined `directory`/`file` as a collapsible container in
  // Milestone 17e, once a table can have `column` children -- see
  // `collapseDirectories.ts`'s `CONTAINER_KINDS`, the single source of
  // truth this mirrors.
  const isContainerKind =
    nodeData.kind === 'directory' || nodeData.kind === 'file' || nodeData.kind === 'table'
  const chevron = !isContainerKind
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
        fontFamily: font.ui,
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
  column: GraphNodeComponent,
}
