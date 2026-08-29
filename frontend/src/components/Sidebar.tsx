import { useMemo, useState } from 'react'
import type { GraphEdge, GraphNode } from '../api/types'
import { colors, radius, spacing } from '../theme'
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
  /** Dims every node on the canvas that isn't a table, dbt model, or the
   * code directly reading/writing one -- a filter over the same graph, not
   * a separate view, so impact analysis still traverses code and data
   * together. Only ever rendered once `nodes` contains at least one table/
   * dbt-model node (see `dataNodeCounts` below). */
  dataOnlyActive: boolean
  onToggleDataOnly: () => void
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
  dataOnlyActive,
  onToggleDataOnly,
  onExpandAll,
  onCollapseAll,
  selectedRootIds,
  onToggleRootSelection,
  onResetSelection,
  collapsed = false,
  onToggleCollapsed = () => {},
}: SidebarProps) {
  const [query, setQuery] = useState('')

  // Counts, not just a boolean -- shown as the "N tables · M dbt models"
  // helper line once a source is connected, so the sidebar states what's
  // actually on the graph rather than just "something is connected".
  // Table/dbt-model nodes can exist before any manual ingest, too --
  // SQLAlchemy model detection (Milestone 17a) runs automatically on every
  // parse -- so this reads `nodes` directly rather than gating on
  // `dataSourceActive`.
  const dataNodeCounts = useMemo(() => {
    let tables = 0
    let dbtModels = 0
    for (const node of nodes) {
      if (node.kind === 'table') tables += 1
      else if (node.kind === 'dbt_model') dbtModels += 1
    }
    return { tables, dbtModels, total: tables + dbtModels }
  }, [nodes])

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
        }}
      >
        <CollapseToggle collapsed onClick={onToggleCollapsed} edge="left" paneName="sidebar" fill />
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
      <div style={{ display: 'flex', padding: spacing.sm, gap: spacing.xs, alignItems: 'center' }}>
        <CollapseToggle collapsed={false} onClick={onToggleCollapsed} edge="left" paneName="sidebar" />
        {(['codebase', 'file'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => onViewChange(option)}
            className="sv-interactive"
            title={
              option === 'codebase'
                ? 'Show the whole repository as one graph'
                : "Show only the open file's own structure"
            }
            style={{
              flex: 1,
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: view === option ? colors.accent : 'transparent',
              color: colors.textPrimary,
              fontSize: 12,
              fontWeight: view === option ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {option === 'codebase' ? 'Codebase' : 'Current file'}
          </button>
        ))}
      </div>
      <div
        style={{
          padding: `0 ${spacing.sm}px ${spacing.sm}px`,
          fontSize: 11,
          color: colors.textDim,
          lineHeight: 1.4,
        }}
      >
        {view === 'codebase'
          ? 'Start here — browse the whole repo as one graph you can drag, zoom, and expand.'
          : "A focused view of just the file you have open right now."}
      </div>

      <div
        style={{
          padding: `${spacing.xs}px ${spacing.sm}px 2px`,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: colors.textDim,
        }}
      >
        Analysis
      </div>
      <div style={{ padding: `0 ${spacing.sm}px ${spacing.sm}px` }}>
        <button
          type="button"
          aria-pressed={complexityActive}
          onClick={onToggleComplexity}
          className="sv-interactive"
          title="Highlight every function by cyclomatic complexity and rank them in a report"
          style={{
            width: '100%',
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: radius.sm,
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

      <div
        style={{
          padding: `${spacing.xs}px ${spacing.sm}px 2px`,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: colors.dataLineageHeading,
        }}
      >
        Data lineage
      </div>
      <div style={{ padding: `0 ${spacing.sm}px ${spacing.sm}px` }}>
        <button
          type="button"
          aria-pressed={dataSourceActive}
          onClick={onToggleDataSource}
          className="sv-interactive"
          title="Add tables and models from SQLAlchemy, dbt, or a live database to this graph"
          style={{
            width: '100%',
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: radius.sm,
            border: `1px solid ${colors.border}`,
            background: dataSourceActive ? colors.dataSourceActiveBg : 'transparent',
            color: colors.textPrimary,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Add tables &amp; models
        </button>
        {dataNodeCounts.total > 0 && (
          <>
            <div style={{ margin: `${spacing.xs}px 2px 0`, fontSize: 10.5, color: colors.textDim }}>
              {dataNodeCounts.tables} table{dataNodeCounts.tables === 1 ? '' : 's'}
              {dataNodeCounts.dbtModels > 0
                ? ` · ${dataNodeCounts.dbtModels} dbt model${dataNodeCounts.dbtModels === 1 ? '' : 's'}`
                : ''}
            </div>
            <button
              type="button"
              aria-pressed={dataOnlyActive}
              onClick={onToggleDataOnly}
              className="sv-interactive"
              title="Dim everything that isn't a table, dbt model, or code reading/writing one -- the same graph and impact analysis, just filtered to this view"
              style={{
                width: '100%',
                marginTop: spacing.xs,
                padding: `${spacing.xs}px ${spacing.sm}px`,
                borderRadius: radius.sm,
                border: `1px solid ${colors.border}`,
                background: dataOnlyActive ? colors.dataSourceActiveBg : 'transparent',
                color: colors.textPrimary,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Data only</span>
              <span aria-hidden="true">{dataOnlyActive ? 'On' : 'Off'}</span>
            </button>
          </>
        )}
      </div>

      {view === 'codebase' && (
        <div
          style={{
            padding: `${spacing.xs}px ${spacing.sm}px 2px`,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: colors.textDim,
          }}
        >
          Canvas
        </div>
      )}
      {view === 'codebase' && (
        <div
          style={{
            display: 'flex',
            padding: `0 ${spacing.sm}px ${spacing.sm}px`,
            gap: spacing.sm,
            alignItems: 'center',
          }}
        >
          <span
            style={{ fontSize: 11, color: colors.textMuted }}
            title="How many directories, files, or tables are currently checked to appear on the canvas"
          >
            {selectedRootIds.size === 0
              ? 'Nothing on canvas yet'
              : `${selectedRootIds.size} on canvas`}
          </span>
          <button
            type="button"
            onClick={onResetSelection}
            disabled={selectedRootIds.size === 0}
            className="sv-interactive"
            title="Clear everything from the canvas"
            style={{
              marginLeft: 'auto',
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
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
        <div
          style={{ display: 'flex', padding: `0 ${spacing.sm}px ${spacing.sm}px`, gap: spacing.xs }}
        >
          <button
            type="button"
            onClick={onExpandAll}
            className="sv-interactive"
            title="Expand every directory and file already on the canvas"
            style={{
              flex: 1,
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
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
            title="Collapse every directory and file back down"
            style={{
              flex: 1,
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm,
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
      {view === 'codebase' && (
        <div
          style={{
            padding: `0 ${spacing.sm}px ${spacing.sm}px`,
            marginTop: -4,
            fontSize: 11,
            color: colors.textDim,
            lineHeight: 1.4,
          }}
        >
          Opens or closes everything already on your canvas. The ▸ arrows below are separate — they
          only change what you see in this list, not the canvas.
        </div>
      )}

      <div style={{ padding: `0 ${spacing.sm}px ${spacing.sm}px`, position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
          placeholder="Filter files and functions"
          aria-label="Filter tree"
          title="Filter the tree below by file or function name"
          style={{
            width: '100%',
            padding: `5px ${spacing.xl}px 5px ${spacing.sm}px`,
            borderRadius: radius.sm,
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
            title="Clear filter"
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
        <p
          role="status"
          style={{ margin: `0 ${spacing.sm}px ${spacing.sm}px`, fontSize: 11, color: colors.textMuted }}
        >
          {matchIds.size} match{matchIds.size === 1 ? '' : 'es'}
        </p>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${spacing.sm}px ${spacing.sm}px` }}>
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
