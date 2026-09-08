import { useMemo, useState } from 'react'
import { getImpact } from '../api/client'
import type { Caller, ComplexityScore, GraphNode } from '../api/types'
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
import { RankedFunctionRow } from './RankedFunctionRow'

interface PerformanceReportPaneProps {
  path: string
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
        function. Click a row to select it; use ▸ to see who directly calls it.
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

// `GET /api/impact` only ever has caller (upstream) data, not callee
// (downstream) data -- there's no backend endpoint for "what does this
// function call" -- so the drill-down surfaces a complex function's own
// direct callers instead: who actually depends on it, cross-referenced
// against their own complexity scores. Reuses the existing impact
// endpoint rather than adding a new backend surface for this pane.
type DrillDown =
  | { nodeId: string; status: 'loading' }
  | { nodeId: string; status: 'loaded'; callers: Caller[] }
  | { nodeId: string; status: 'error'; message: string }

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
  path,
  scores,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: PerformanceReportPaneProps) {
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null)
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<ComplexityTier>('any')
  const [minDepth, setMinDepth] = useState(0)
  const [sortBy, setSortBy] = useState<SortBy>('complexity-desc')

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])
  const scoresByNodeId = useMemo(() => new Map(scores.map((score) => [score.node_id, score])), [scores])

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

  async function toggleDrillDown(nodeId: string) {
    if (drillDown?.nodeId === nodeId) {
      setDrillDown(null)
      return
    }
    setDrillDown({ nodeId, status: 'loading' })
    try {
      const result = await getImpact(path, nodeId)
      setDrillDown({ nodeId, status: 'loaded', callers: result.callers.filter((c) => c.direct) })
    } catch (error) {
      setDrillDown({
        nodeId,
        status: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      })
    }
  }

  if (scores.length === 0) {
    return <p style={{ color: colors.textMuted }}>No functions found.</p>
  }

  return (
    <>
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
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map((score) => (
            <li key={score.node_id}>
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
                  ...(score.call_chain_depth > 0
                    ? [{ label: `Depth ${score.call_chain_depth}` }]
                    : []),
                  ...(score.has_nested_loops ? [{ label: 'Nested loops' }] : []),
                ]}
                trailing={
                  <button
                    type="button"
                    aria-label={
                      drillDown?.nodeId === score.node_id
                        ? `Hide callers of ${score.node_id}`
                        : `Show callers of ${score.node_id}`
                    }
                    title={
                      drillDown?.nodeId === score.node_id ? 'Hide direct callers' : 'Show direct callers'
                    }
                    onClick={() => void toggleDrillDown(score.node_id)}
                    className="sv-interactive"
                    style={{
                      background: colors.bgPanel,
                      border: `1px solid ${colors.border}`,
                      borderRadius: radius.sm,
                      color: colors.textMuted,
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: `0 ${spacing.xs}px`,
                      flexShrink: 0,
                    }}
                  >
                    {drillDown?.nodeId === score.node_id ? '▾' : '▸'}
                  </button>
                }
              />
              {drillDown?.nodeId === score.node_id && (
                <div style={{ margin: `-4px 0 ${spacing.xs}px ${spacing.xl}px` }}>
                  {drillDown.status === 'loading' && (
                    <p style={{ color: colors.textMuted, fontSize: 11, margin: 0 }}>Loading…</p>
                  )}
                  {drillDown.status === 'error' && (
                    <p role="alert" style={{ color: colors.danger, fontSize: 11, margin: 0 }}>
                      {drillDown.message}
                    </p>
                  )}
                  {drillDown.status === 'loaded' && drillDown.callers.length === 0 && (
                    <p style={{ color: colors.textMuted, fontSize: 11, margin: 0 }}>No direct callers.</p>
                  )}
                  {drillDown.status === 'loaded' && drillDown.callers.length > 0 && (
                    <p style={{ color: colors.textDim, fontSize: 11, margin: '0 0 2px' }}>
                      Direct callers (functions that call this one):
                    </p>
                  )}
                  {drillDown.status === 'loaded' &&
                    drillDown.callers.map((caller) => {
                      const callerScore = scoresByNodeId.get(caller.id)
                      return (
                        <button
                          key={caller.id}
                          type="button"
                          onClick={() => onSelectNode(caller.id)}
                          className="sv-interactive"
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            background: 'transparent',
                            border: 'none',
                            color: colors.textFaint,
                            padding: '2px 0',
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          {displayName(caller.id)}
                          {callerScore ? ` (complexity ${callerScore.cyclomatic_complexity})` : ''}
                        </button>
                      )
                    })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
