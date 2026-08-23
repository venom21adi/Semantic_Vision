import { useMemo, useState } from 'react'
import type { GraphEdge, GraphNode } from '../api/types'
import { CollapseToggle } from './CollapseToggle'
import { Tree } from './Tree'
import { buildTree, collectMatchIds, collectVisiblePath } from '../tree/buildTree'

export type GraphView = 'codebase' | 'file'

interface SidebarProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  view: GraphView
  onViewChange: (view: GraphView) => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function Sidebar({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  view,
  onViewChange,
  collapsed = false,
  onToggleCollapsed = () => {},
}: SidebarProps) {
  const [query, setQuery] = useState('')

  const tree = useMemo(() => buildTree(nodes, edges), [nodes, edges])
  const matchIds = useMemo(() => collectMatchIds(tree, query), [tree, query])
  const visibleIds = useMemo(() => collectVisiblePath(tree, matchIds), [tree, matchIds])
  const isFiltering = query.trim().length > 0

  if (collapsed) {
    return (
      <aside
        style={{
          width: 28,
          flexShrink: 0,
          borderRight: '1px solid #1e293b',
          padding: '8px 4px',
        }}
      >
        <CollapseToggle collapsed onClick={onToggleCollapsed} edge="left" paneName="sidebar" />
      </aside>
    )
  }

  return (
    <aside
      style={{
        width: 260,
        flexShrink: 0,
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', padding: 8, gap: 4, alignItems: 'center' }}>
        <CollapseToggle collapsed={false} onClick={onToggleCollapsed} edge="left" paneName="sidebar" />
        {(['codebase', 'file'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => onViewChange(option)}
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #334155',
              background: view === option ? '#2563eb' : 'transparent',
              color: '#f8fafc',
              fontSize: 12,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {option}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 8px 8px', position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
          placeholder="Filter files and functions"
          aria-label="Filter tree"
          style={{
            width: '100%',
            padding: '5px 24px 5px 8px',
            borderRadius: 4,
            border: '1px solid #334155',
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: 12,
            boxSizing: 'border-box',
          }}
        />
        {isFiltering && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => setQuery('')}
            style={{
              position: 'absolute',
              right: 14,
              top: 5,
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {isFiltering && (
        <p role="status" style={{ margin: '0 8px 8px', fontSize: 11, color: '#94a3b8' }}>
          {matchIds.size} match{matchIds.size === 1 ? '' : 'es'}
        </p>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        <Tree
          roots={tree}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          visibleIds={visibleIds}
          matchIds={matchIds}
        />
      </div>
    </aside>
  )
}
