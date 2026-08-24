import { useState } from 'react'
import { getImpact } from '../api/client'
import type { Caller, ComplexityScore } from '../api/types'
import {
  COMPLEX_COLOR,
  MODERATE_COLOR,
  MODERATE_MAX,
  SIMPLE_COLOR,
  SIMPLE_MAX,
  complexityToColor,
} from '../graph/heatmap'

interface PerformanceReportPaneProps {
  path: string
  scores: ComplexityScore[]
  onSelectNode: (nodeId: string) => void
}

function Legend() {
  return (
    <div style={{ marginBottom: 10, fontSize: 11, color: '#94a3b8' }}>
      <p style={{ margin: '0 0 6px' }}>
        Ranked by cyclomatic complexity — roughly, how many independent paths through each
        function. Click a name to select it; use ▸ to see who directly calls it.
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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

export function PerformanceReportPane({ path, scores, onSelectNode }: PerformanceReportPaneProps) {
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null)

  if (scores.length === 0) {
    return <p style={{ color: '#94a3b8' }}>No functions found.</p>
  }

  const scoresByNodeId = new Map(scores.map((score) => [score.node_id, score]))
  const ranked = [...scores].sort((a, b) => b.cyclomatic_complexity - a.cyclomatic_complexity)

  function scoreDetail(score: ComplexityScore): string {
    const parts = [`complexity ${score.cyclomatic_complexity}`]
    if (score.call_chain_depth > 0) parts.push(`call depth ${score.call_chain_depth}`)
    if (score.has_nested_loops) parts.push('nested loops')
    return parts.join(', ')
  }

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

  return (
    <>
      <Legend />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ranked.map((score) => (
          <li key={score.node_id} style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: complexityToColor(score.cyclomatic_complexity),
                  flexShrink: 0,
                }}
              />
              <button
                type="button"
                onClick={() => onSelectNode(score.node_id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  padding: '2px 0',
                  cursor: 'pointer',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {score.node_id} <span style={{ color: '#64748b' }}>({scoreDetail(score)})</span>
              </button>
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
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '0 4px',
                  flexShrink: 0,
                }}
              >
                {drillDown?.nodeId === score.node_id ? '▾' : '▸'}
              </button>
            </div>
            {drillDown?.nodeId === score.node_id && (
              <div style={{ marginLeft: 16, marginTop: 2 }}>
                {drillDown.status === 'loading' && (
                  <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>Loading…</p>
                )}
                {drillDown.status === 'error' && (
                  <p role="alert" style={{ color: '#fca5a5', fontSize: 11, margin: 0 }}>
                    {drillDown.message}
                  </p>
                )}
                {drillDown.status === 'loaded' && drillDown.callers.length === 0 && (
                  <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>No direct callers.</p>
                )}
                {drillDown.status === 'loaded' && drillDown.callers.length > 0 && (
                  <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 2px' }}>
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
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          color: '#cbd5e1',
                          padding: '2px 0',
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        {caller.id}
                        {callerScore ? ` (complexity ${callerScore.cyclomatic_complexity})` : ''}
                      </button>
                    )
                  })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
