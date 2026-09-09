import { useMemo, useState } from 'react'
import type { CoverageRiskScore, GraphNode } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import {
  COMPLEX_COLOR,
  MODERATE_COLOR,
  MODERATE_MAX,
  SIMPLE_COLOR,
  SIMPLE_MAX,
  complexityToColor,
} from '../graph/heatmap'
import { colors, radius, spacing } from '../theme'
import { RankedFunctionRow, ROW_HEIGHT } from './RankedFunctionRow'
import { VirtualList } from './VirtualList'

interface CoverageReportPaneProps {
  scores: CoverageRiskScore[]
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

type ComplexityTier = 'any' | 'simple' | 'moderate' | 'complex'
type SortBy = 'risk-desc' | 'coverage-asc' | 'complexity-desc' | 'name'

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

function matchesTier(score: CoverageRiskScore, tier: ComplexityTier): boolean {
  if (tier === 'any') return true
  if (tier === 'simple') return score.cyclomatic_complexity <= SIMPLE_MAX
  if (tier === 'moderate') {
    return score.cyclomatic_complexity > SIMPLE_MAX && score.cyclomatic_complexity <= MODERATE_MAX
  }
  return score.cyclomatic_complexity > MODERATE_MAX
}

// Inverted from `complexityToColor`'s own bands: low coverage is the risky
// direction here, so it borrows the same red/amber/green palette rather
// than inventing a second one, just applied in reverse.
function coverageToColor(ratio: number | null): string | undefined {
  if (ratio === null) return undefined
  if (ratio >= 0.8) return SIMPLE_COLOR
  if (ratio >= 0.4) return MODERATE_COLOR
  return COMPLEX_COLOR
}

// A standalone pane, matching `HotspotReportPane`/`DeadCodeReportPane`'s own
// precedent -- a different data shape (no `call_chain_depth`, an extra
// `coverage_ratio`/`blast_radius` pair) rather than a sort mode bolted onto
// `PerformanceReportPane`.
export function CoverageReportPane({
  scores,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: CoverageReportPaneProps) {
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<ComplexityTier>('any')
  const [sortBy, setSortBy] = useState<SortBy>('risk-desc')

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
      case 'coverage-asc':
        // No-data (`null`) sorts first -- it's the least-known, so
        // treated as the most in need of attention, same as this pane's
        // own `risk_score` formula treats it as worst-case.
        sorted.sort((a, b) => (a.coverage_ratio ?? -1) - (b.coverage_ratio ?? -1))
        break
      case 'complexity-desc':
        sorted.sort((a, b) => b.cyclomatic_complexity - a.cyclomatic_complexity)
        break
      case 'name':
        sorted.sort((a, b) => displayName(a.node_id).localeCompare(displayName(b.node_id)))
        break
      default:
        sorted.sort((a, b) => b.risk_score - a.risk_score)
    }
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, query, tier, sortBy, graphNodeById])

  if (scores.length === 0) {
    return <p style={{ color: colors.textMuted }}>No functions found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Ranked by complexity × (1 + blast radius) × (1 − coverage) — where correctness risk
        actually concentrates, not any one number alone. A function with no coverage data is
        treated as worst-case, not zero-risk.
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
          <option value="risk-desc">Risk score</option>
          <option value="coverage-asc">Least covered</option>
          <option value="complexity-desc">Complexity</option>
          <option value="name">Name</option>
        </select>
      </div>
      {visible.length === 0 ? (
        <p style={{ color: colors.textMuted }}>No functions match this filter.</p>
      ) : (
        <VirtualList
          items={visible}
          itemHeight={ROW_HEIGHT}
          getKey={(score) => score.node_id}
          renderItem={(score) => (
            <RankedFunctionRow
              nodeId={score.node_id}
              graphNode={graphNodeById.get(score.node_id)}
              selected={score.node_id === selectedNodeId}
              onSelect={() => onSelectNode(score.node_id)}
              badges={[
                {
                  label:
                    score.coverage_ratio === null
                      ? 'No coverage data'
                      : `Coverage ${Math.round(score.coverage_ratio * 100)}%`,
                  color: coverageToColor(score.coverage_ratio),
                },
                {
                  label: `Complexity ${score.cyclomatic_complexity}`,
                  color: complexityToColor(score.cyclomatic_complexity),
                },
                { label: `Blast radius ${score.blast_radius}` },
              ]}
            />
          )}
        />
      )}
    </div>
  )
}
