import { useMemo, useState } from 'react'
import type { ComplexityScore, GraphNode } from '../api/types'
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

interface PerformanceReportPaneProps {
  scores: ComplexityScore[]
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

function Legend() {
  return (
    <div style={{ marginBottom: 10, fontSize: 11, color: colors.textMuted }}>
      <p style={{ margin: '0 0 6px' }}>
        Ranked by cyclomatic complexity — roughly, how many independent paths through each
        function. Click a row to see who calls it and what it calls.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <LegendSwatch color={SIMPLE_COLOR} label={`Simple (1–${SIMPLE_MAX})`} />
        <LegendSwatch color={MODERATE_COLOR} label={`Moderate (${SIMPLE_MAX + 1}–${MODERATE_MAX})`} />
        <LegendSwatch color={COMPLEX_COLOR} label={`Complex (${MODERATE_MAX + 1}+)`} />
      </div>
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs }}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      {label}
    </span>
  )
}

type ComplexityTier = 'any' | 'simple' | 'moderate' | 'complex'
type SortBy = 'complexity-desc' | 'complexity-asc' | 'name' | 'depth'

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

function matchesTier(score: ComplexityScore, tier: ComplexityTier): boolean {
  if (tier === 'any') return true
  if (tier === 'simple') return score.cyclomatic_complexity <= SIMPLE_MAX
  if (tier === 'moderate') {
    return score.cyclomatic_complexity > SIMPLE_MAX && score.cyclomatic_complexity <= MODERATE_MAX
  }
  return score.cyclomatic_complexity > MODERATE_MAX
}

export function PerformanceReportPane({
  scores,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: PerformanceReportPaneProps) {
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<ComplexityTier>('any')
  const [minDepth, setMinDepth] = useState(0)
  const [sortBy, setSortBy] = useState<SortBy>('complexity-desc')

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])

  function displayName(nodeId: string): string {
    const node = graphNodeById.get(nodeId)
    return node ? formatNodeLabel(node.label, node.accessor_kind) : nodeId
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = scores.filter((score) => {
      if (!matchesTier(score, tier)) return false
      if (score.call_chain_depth < minDepth) return false
      if (!q) return true
      const node = graphNodeById.get(score.node_id)
      const name = node ? formatNodeLabel(node.label, node.accessor_kind).toLowerCase() : ''
      const file = node?.file.toLowerCase() ?? ''
      return name.includes(q) || file.includes(q) || score.node_id.toLowerCase().includes(q)
    })
    const sorted = [...filtered]
    switch (sortBy) {
      case 'complexity-asc':
        sorted.sort((a, b) => a.cyclomatic_complexity - b.cyclomatic_complexity)
        break
      case 'name':
        sorted.sort((a, b) => displayName(a.node_id).localeCompare(displayName(b.node_id)))
        break
      case 'depth':
        sorted.sort((a, b) => b.call_chain_depth - a.call_chain_depth)
        break
      default:
        sorted.sort((a, b) => b.cyclomatic_complexity - a.cyclomatic_complexity)
    }
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, query, tier, minDepth, sortBy, graphNodeById])

  if (scores.length === 0) {
    return <p style={{ color: colors.textMuted }}>No functions found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Legend />
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
        <label style={{ fontSize: 11, color: colors.textMuted, display: 'flex', gap: 4, alignItems: 'center' }}>
          Min depth
          <input
            type="number"
            min={0}
            value={minDepth}
            onChange={(event) => setMinDepth(Math.max(0, Number(event.target.value) || 0))}
            aria-label="Minimum call depth"
            style={{ ...controlStyle, width: 48 }}
          />
        </label>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as SortBy)}
          aria-label="Sort functions"
          style={controlStyle}
        >
          <option value="complexity-desc">Complexity (high to low)</option>
          <option value="complexity-asc">Complexity (low to high)</option>
          <option value="name">Name</option>
          <option value="depth">Call depth</option>
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
                  label: `Complexity ${score.cyclomatic_complexity}`,
                  color: complexityToColor(score.cyclomatic_complexity),
                },
                ...(score.call_chain_depth > 0 ? [{ label: `Depth ${score.call_chain_depth}` }] : []),
                ...(score.has_nested_loops ? [{ label: 'Nested loops' }] : []),
              ]}
            />
          )}
        />
      )}
    </div>
  )
}
