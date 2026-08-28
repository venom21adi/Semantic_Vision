import { useState } from 'react'
import type { NodeKind } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { CONTAINER_KINDS } from '../graph/collapseDirectories'
import { KIND_COLORS } from '../graph/nodeTypes'
import { colors as themeColors } from '../theme'
import { isExpandedByDefault, type TreeNode } from '../tree/buildTree'

/** Kinds that get their own "show on canvas" checkbox in addition to
 * `CONTAINER_KINDS` (directory/file, which can appear at any depth). A
 * `table`/`dbt_model` node has no `defines` parent and no children of
 * its own (see `rootNodeIds` in `tree/buildTree.ts`) -- it's always a
 * standalone root item, never nested -- but without a checkbox here it
 * could never be individually hidden from the canvas except via "Reset
 * selection", which clears every selected root at once. */
const ADDITIONAL_SELECTABLE_KINDS = new Set<NodeKind>(['table', 'dbt_model'])

interface TreeProps {
  roots: TreeNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  /** Ids that must render expanded and visible (a filter is active);
   * `null` means no filter -- fall back to each item's own expand state. */
  visibleIds: Set<string> | null
  matchIds: Set<string>
  /** Ids currently checked to appear on the canvas (directory/file rows,
   * plus `table`/`dbt_model` rows -- see `CONTAINER_KINDS` and
   * `ADDITIONAL_SELECTABLE_KINDS`). `null` means the selection feature is
   * off for this render (the File view's tree, whose canvas doesn't derive
   * from a selection at all) -- no checkbox column renders in that case. */
  selectedRootIds: ReadonlySet<string> | null
  onToggleRootSelection: (id: string) => void
}

export function Tree({
  roots,
  selectedNodeId,
  onSelectNode,
  visibleIds,
  matchIds,
  selectedRootIds,
  onToggleRootSelection,
}: TreeProps) {
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({})

  function toggle(id: string, defaultExpanded: boolean) {
    setManualExpanded((current) => ({
      ...current,
      [id]: !(current[id] ?? defaultExpanded),
    }))
  }

  function renderItem(item: TreeNode, depth: number) {
    if (visibleIds && !visibleIds.has(item.node.id)) return null

    const defaultExpanded = isExpandedByDefault(item)
    const expanded = visibleIds ? true : (manualExpanded[item.node.id] ?? defaultExpanded)
    const hasChildren = item.children.length > 0
    const isMatch = matchIds.has(item.node.id)
    const colors = KIND_COLORS[item.node.kind]
    const displayLabel = formatNodeLabel(item.node.label, item.node.accessor_kind)

    return (
      <li key={item.node.id}>
        <div
          role="treeitem"
          aria-selected={item.node.id === selectedNodeId}
          aria-expanded={hasChildren ? expanded : undefined}
          data-match={isMatch || undefined}
          tabIndex={0}
          onClick={() => onSelectNode(item.node.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelectNode(item.node.id)
            }
          }}
          className="sv-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: depth * 14 + 4,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: 'pointer',
            fontSize: 13,
            background: item.node.id === selectedNodeId ? themeColors.infoBg : 'transparent',
            outline: isMatch ? `1px solid ${themeColors.matchHighlight}` : 'none',
            borderRadius: 3,
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${displayLabel}` : `Expand ${displayLabel}`}
              onClick={(event) => {
                event.stopPropagation()
                toggle(item.node.id, defaultExpanded)
              }}
              className="sv-interactive"
              style={{
                background: 'transparent',
                border: 'none',
                color: themeColors.textMuted,
                cursor: 'pointer',
                width: 14,
                padding: 0,
                fontSize: 10,
              }}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: 14 }} />
          )}
          {selectedRootIds !== null &&
            (CONTAINER_KINDS.has(item.node.kind) ||
            ADDITIONAL_SELECTABLE_KINDS.has(item.node.kind) ? (
              <input
                type="checkbox"
                aria-label={`Show ${displayLabel} on canvas`}
                checked={selectedRootIds.has(item.node.id)}
                onClick={(event) => event.stopPropagation()}
                // The row wrapper's own `onKeyDown` (Space/Enter -> select)
                // would otherwise still fire on the bubbled keydown -- and
                // its `preventDefault()` would cancel the checkbox's native
                // space-activation too, since `defaultPrevented` is shared
                // across the whole bubble path -- silently blocking keyboard
                // toggling entirely while mis-selecting the row instead.
                // Stopping propagation here, before it reaches the row,
                // keeps the checkbox's native Space/Enter handling intact.
                onKeyDown={(event) => event.stopPropagation()}
                onChange={() => onToggleRootSelection(item.node.id)}
                style={{ margin: 0, flexShrink: 0, cursor: 'pointer' }}
              />
            ) : (
              <span style={{ width: 13, flexShrink: 0 }} />
            ))}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: colors.background,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: themeColors.textPrimary,
            }}
          >
            {displayLabel}
          </span>
        </div>
        {hasChildren && expanded && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {item.children.map((child) => renderItem(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <ul role="tree" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {roots.map((root) => renderItem(root, 0))}
    </ul>
  )
}
