import type { HotspotScore } from '../api/types'
import { colors, spacing } from '../theme'
import { complexityToColor } from '../graph/heatmap'

interface HotspotReportPaneProps {
  scores: HotspotScore[]
  onSelectNode: (nodeId: string) => void
}

// A standalone pane rather than a sort-mode on `PerformanceReportPane` --
// that component's sort is a single hardcoded line with no mode concept to
// extend, and its legend/drill-down are complexity-specific. Row color still
// reuses `complexityToColor` (unchanged) rather than inventing a second
// color scale for `hotspot_score`'s different magnitude -- the backend
// already returns the list pre-sorted by hotspot score, so rank order
// carries the relative-risk signal the color would otherwise duplicate.
export function HotspotReportPane({ scores, onSelectNode }: HotspotReportPaneProps) {
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
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {scores.map((score) => (
          <li key={score.node_id} style={{ marginBottom: spacing.xs }}>
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
                className="sv-interactive"
                style={{
                  flex: 1,
                  minWidth: 0,
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
                {score.node_id}{' '}
                <span style={{ color: colors.textDim }}>
                  (hotspot {score.hotspot_score}, complexity {score.cyclomatic_complexity}, changed{' '}
                  {score.change_count}×)
                </span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
