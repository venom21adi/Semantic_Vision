import { useState } from 'react'
import { KIND_COLORS } from '../graph/nodeTypes'
import { isExpandedByDefault, type TreeNode } from '../tree/buildTree'

interface TreeProps {
  roots: TreeNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  /** Ids that must render expanded and visible (a filter is active);
   * `null` means no filter -- fall back to each item's own expand state. */
  visibleIds: Set<string> | null
  matchIds: Set<string>
}

export function Tree({ roots, selectedNodeId, onSelectNode, visibleIds, matchIds }: TreeProps) {
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
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: depth * 14 + 4,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: 'pointer',
            fontSize: 13,
            background: item.node.id === selectedNodeId ? '#1e3a5f' : 'transparent',
            outline: isMatch ? '1px solid #fbbf24' : 'none',
            borderRadius: 3,
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${item.node.label}` : `Expand ${item.node.label}`}
              onClick={(event) => {
                event.stopPropagation()
                toggle(item.node.id, defaultExpanded)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
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
              color: '#f8fafc',
            }}
          >
            {item.node.label}
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
