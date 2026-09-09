import { useMemo, useState } from 'react'
import type { DuplicateGroup, GraphNode } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { colors, radius, spacing } from '../theme'
import { RankedFunctionRow, ROW_HEIGHT } from './RankedFunctionRow'
import { VirtualList } from './VirtualList'

interface DuplicatesReportPaneProps {
  groups: DuplicateGroup[]
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

// Badges overflow-clip (see `RankedFunctionRow`'s own `flexWrap: 'nowrap'`),
// so listing every other member isn't necessary -- a handful is enough to
// give a real sense of the group without risking a badge row so long it
// visibly clips mid-name.
const MAX_MEMBER_BADGES = 3

// A standalone pane, matching HotspotReportPane/DeadCodeReportPane/
// CoverageReportPane's own precedent. Unlike those, the unit here is a
// *group* of functions, not one function -- each row represents a group,
// keyed by and jumping to its first member (consistent with every other
// tab's single-selection model; there's no multi-node selection in
// `CodeHealthDetail`). No sort selector: the backend already sorts by
// group size descending, and there's no other magnitude to sort by (same
// reasoning `DeadCodeReportPane` gives for its own lack of one).
export function DuplicatesReportPane({
  groups,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: DuplicatesReportPaneProps) {
  const [query, setQuery] = useState('')

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])

  function displayName(nodeId: string): string {
    const node = graphNodeById.get(nodeId)
    return node ? formatNodeLabel(node.label, node.accessor_kind) : nodeId
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((group) =>
      group.node_ids.some((nodeId) => {
        const node = graphNodeById.get(nodeId)
        const name = node ? formatNodeLabel(node.label, node.accessor_kind).toLowerCase() : ''
        const file = node?.file.toLowerCase() ?? ''
        return name.includes(q) || file.includes(q) || nodeId.toLowerCase().includes(q)
      }),
    )
  }, [groups, query, graphNodeById])

  if (groups.length === 0) {
    return <p style={{ color: colors.textMuted }}>No duplicate-function groups found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Functions whose structure is identical once names, literals, and comments are stripped
        away — a real copy-paste cost the complexity score alone can't see. Exact-shape matches
        only, not near-misses.
      </p>
      <div style={{ marginBottom: spacing.sm }}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name or file"
          aria-label="Filter functions"
          style={{ ...controlStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      {visible.length === 0 ? (
        <p style={{ color: colors.textMuted }}>No groups match this filter.</p>
      ) : (
        <VirtualList
          items={visible}
          itemHeight={ROW_HEIGHT}
          getKey={(group) => group.node_ids[0]}
          renderItem={(group) => {
            const [primary, ...others] = group.node_ids
            return (
              <RankedFunctionRow
                nodeId={primary}
                graphNode={graphNodeById.get(primary)}
                selected={primary === selectedNodeId}
                onSelect={() => onSelectNode(primary)}
                badges={[
                  { label: `${group.size} similar functions` },
                  ...others
                    .slice(0, MAX_MEMBER_BADGES)
                    .map((nodeId) => ({ label: displayName(nodeId) })),
                ]}
              />
            )
          }}
        />
      )}
    </div>
  )
}
