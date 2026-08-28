import { useMemo, useState } from 'react'
import type { GraphEdge, GraphNode } from '../api/types'
import { colors } from '../theme'
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
  complexityActive: boolean
  onToggleComplexity: () => void
  dataSourceActive: boolean
  onToggleDataSource: () => void
  /** Expands/collapses every directory and file in the codebase-view
   * graph at once -- the escape hatch back to full detail for a large
   * repo that starts mostly collapsed by default. */
  onExpandAll: () => void
  onCollapseAll: () => void
  /** Ids of directories/files currently checked to appear on the
   * codebase-view canvas. */
  selectedRootIds: ReadonlySet<string>
  onToggleRootSelection: (id: string) => void
  onResetSelection: () => void
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
  complexityActive,
  onToggleComplexity,
  dataSourceActive,
  onToggleDataSource,
  onExpandAll,
  onCollapseAll,
  selectedRootIds,
  onToggleRootSelection,
  onResetSelection,
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
          borderRight: `1px solid ${colors.bgPanel}`,
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
        borderRight: `1px solid ${colors.bgPanel}`,
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
            className="sv-interactive"
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: view === option ? colors.accent : 'transparent',
              color: colors.textPrimary,
              fontSize: 12,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {option}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 8px 8px' }}>
        <button
          type="button"
          aria-pressed={complexityActive}
          onClick={onToggleComplexity}
          className="sv-interactive"
          style={{
            width: '100%',
            padding: '4px 8px',
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: complexityActive ? colors.complexityActiveBg : 'transparent',
            color: colors.textPrimary,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {complexityActive ? 'Hide complexity' : 'Show complexity'}
        </button>
      </div>

      <div style={{ padding: '0 8px 8px' }}>
        <button
          type="button"
          aria-pressed={dataSourceActive}
          onClick={onToggleDataSource}
          className="sv-interactive"
          style={{
            width: '100%',
            padding: '4px 8px',
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: dataSourceActive ? colors.dataSourceActiveBg : 'transparent',
            color: colors.textPrimary,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Connect data source
        </button>
      </div>

      {view === 'codebase' && (
        <div style={{ display: 'flex', padding: '0 8px 8px', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: colors.textMuted }}>
            {selectedRootIds.size} selected
          </span>
          <button
            type="button"
            onClick={onResetSelection}
            disabled={selectedRootIds.size === 0}
            className="sv-interactive"
            style={{
              marginLeft: 'auto',
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: selectedRootIds.size === 0 ? colors.disabled : colors.textPrimary,
              fontSize: 12,
              cursor: selectedRootIds.size === 0 ? 'default' : 'pointer',
            }}
          >
            Reset selection
          </button>
        </div>
      )}

      {view === 'codebase' && (
        <div style={{ display: 'flex', padding: '0 8px 8px', gap: 4 }}>
          <button
            type="button"
            onClick={onExpandAll}
            className="sv-interactive"
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.textPrimary,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={onCollapseAll}
            className="sv-interactive"
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.textPrimary,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Collapse all
          </button>
        </div>
      )}

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
            border: `1px solid ${colors.border}`,
            background: colors.bgPage,
            color: colors.textPrimary,
            fontSize: 12,
            boxSizing: 'border-box',
          }}
        />
        {isFiltering && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => setQuery('')}
            className="sv-interactive"
            style={{
              position: 'absolute',
              right: 14,
              top: 5,
              background: 'transparent',
              border: 'none',
              color: colors.textMuted,
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
        <p role="status" style={{ margin: '0 8px 8px', fontSize: 11, color: colors.textMuted }}>
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
          selectedRootIds={view === 'codebase' ? selectedRootIds : null}
          onToggleRootSelection={onToggleRootSelection}
        />
      </div>
    </aside>
  )
}
