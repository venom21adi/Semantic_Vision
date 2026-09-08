import type { DeadCodeCandidate } from '../api/types'
import { colors, spacing } from '../theme'

interface DeadCodeReportPaneProps {
  candidates: DeadCodeCandidate[]
  onSelectNode: (nodeId: string) => void
}

// Mirrors `HotspotReportPane`'s shape (a standalone pane, not a
// `PerformanceReportPane` sort mode) for the same reason -- a different
// data shape and no complexity-report-specific legend/drill-down to reuse.
// No color dot: unlike hotspot score or complexity, "dead code" isn't a
// magnitude to shade, just a yes/no candidate list.
export function DeadCodeReportPane({ candidates, onSelectNode }: DeadCodeReportPaneProps) {
  if (candidates.length === 0) {
    return <p style={{ color: colors.textMuted }}>No dead-code candidates found.</p>
  }

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Functions with no callers anywhere in this repo's call graph, after excluding decorated
        functions, test files/names, dunder methods, and <code>main</code> entry points.
        Candidates to review, not a verdict — a caller outside this repo (a library's public API,
        a framework this tool doesn't recognize) can still be real.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {candidates.map((candidate) => (
          <li key={candidate.node_id} style={{ marginBottom: spacing.xs }}>
            <button
              type="button"
              onClick={() => onSelectNode(candidate.node_id)}
              className="sv-interactive"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: colors.textPrimary,
                padding: '2px 0',
                cursor: 'pointer',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {candidate.node_id}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
