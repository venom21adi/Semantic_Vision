import { useMemo, useState } from 'react'
import type { GraphNode, HotspotScore } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { MODERATE_MAX, SIMPLE_MAX, complexityToColor } from '../graph/heatmap'
import { colors, radius, spacing } from '../theme'
import { RankedFunctionRow } from './RankedFunctionRow'

interface HotspotReportPaneProps {
  scores: HotspotScore[]
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

type ComplexityTier = 'any' | 'simple' | 'moderate' | 'complex'
type SortBy = 'hotspot-desc' | 'changes-desc' | 'complexity-desc' | 'name'

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

function matchesTier(score: HotspotScore, tier: ComplexityTier): boolean {
  if (tier === 'any') return true
  if (tier === 'simple') return score.cyclomatic_complexity <= SIMPLE_MAX
  if (tier === 'moderate') {
    return score.cyclomatic_complexity > SIMPLE_MAX && score.cyclomatic_complexity <= MODERATE_MAX
  }
  return score.cyclomatic_complexity > MODERATE_MAX
}

// A standalone pane rather than a sort-mode on `PerformanceReportPane` --
// that component's legend/drill-down are complexity-specific and its data
// shape differs (`HotspotScore` has no `call_chain_depth`). Row color still
// reuses `complexityToColor` for the complexity badge; the hotspot score
// itself carries the rank order the backend already pre-sorts by.
export function HotspotReportPane({ scores, graphNodes, selectedNodeId, onSelectNode }: HotspotReportPaneProps) {
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<ComplexityTier>('any')
  const [sortBy, setSortBy] = useState<SortBy>('hotspot-desc')

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])

  function displayName(nodeId: string): string {
    const node = graphNodeById.get(nodeId)
    return node ? formatNodeLabel(node.label, node.accessor_kind) : nodeId
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = scores.filter((score) => {
      if (!matchesTier(score, tier)) return false
      if (!q) return true
      const node = graphNodeById.get(score.node_id)
      const name = node ? formatNodeLabel(node.label, node.accessor_kind).toLowerCase() : ''
      const file = node?.file.toLowerCase() ?? ''
      return name.includes(q) || file.includes(q) || score.node_id.toLowerCase().includes(q)
    })
    const sorted = [...filtered]
    switch (sortBy) {
      case 'changes-desc':
        sorted.sort((a, b) => b.change_count - a.change_count)
        break
      case 'complexity-desc':
        sorted.sort((a, b) => b.cyclomatic_complexity - a.cyclomatic_complexity)
        break
      case 'name':
        sorted.sort((a, b) => displayName(a.node_id).localeCompare(displayName(b.node_id)))
        break
      default:
        sorted.sort((a, b) => b.hotspot_score - a.hotspot_score)
    }
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, query, tier, sortBy, graphNodeById])

  if (scores.length === 0) {
    return <p style={{ color: colors.textMuted }}>No functions found.</p>
  }

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Ranked by complexity × how often the file changed in the selected window — a moderately
        complex function edited constantly is a bigger practical risk than a complex one nobody
        touches.
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing.xs,
          marginBottom: spacing.sm,
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name or file"
          aria-label="Filter functions"
          style={{ ...controlStyle, flex: '1 1 160px', minWidth: 120 }}
        />
        <select
          value={tier}
          onChange={(event) => setTier(event.target.value as ComplexityTier)}
          aria-label="Filter by complexity"
          style={controlStyle}
        >
          <option value="any">Any complexity</option>
          <option value="simple">Simple</option>
          <option value="moderate">Moderate</option>
          <option value="complex">Complex</option>
        </select>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as SortBy)}
          aria-label="Sort functions"
          style={controlStyle}
        >
          <option value="hotspot-desc">Hotspot score</option>
          <option value="changes-desc">Times changed</option>
          <option value="complexity-desc">Complexity</option>
          <option value="name">Name</option>
        </select>
      </div>
      {visible.length === 0 ? (
        <p style={{ color: colors.textMuted }}>No functions match this filter.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map((score) => (
            <li key={score.node_id}>
              <RankedFunctionRow
                nodeId={score.node_id}
                graphNode={graphNodeById.get(score.node_id)}
                selected={score.node_id === selectedNodeId}
                onSelect={() => onSelectNode(score.node_id)}
                badges={[
                  { label: `Hotspot ${score.hotspot_score}` },
                  {
                    label: `Complexity ${score.cyclomatic_complexity}`,
                    color: complexityToColor(score.cyclomatic_complexity),
                  },
                  { label: `Changed ${score.change_count}×` },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
