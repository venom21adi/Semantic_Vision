import type { ComplexityScore } from '../api/types'
import { MODERATE_MAX } from '../graph/heatmap'
import { colors, radius, spacing } from '../theme'

interface SummaryStatsHeaderProps {
  scores: ComplexityScore[]
}

interface Stat {
  label: string
  value: string
  color: string
}

function computeStats(scores: ComplexityScore[]): Stat[] {
  if (scores.length === 0) {
    return [{ label: 'Functions scored', value: '0', color: colors.textMuted }]
  }

  const total = scores.length
  const avgComplexity = scores.reduce((sum, s) => sum + s.cyclomatic_complexity, 0) / total
  // `> MODERATE_MAX` is the same "complex" cutoff the heatmap and ranked
  // list already use, reused rather than hardcoding a second definition.
  const complexCount = scores.filter((s) => s.cyclomatic_complexity > MODERATE_MAX).length
  const maxDepth = Math.max(...scores.map((s) => s.call_chain_depth))

  return [
    { label: 'Functions scored', value: String(total), color: colors.textPrimary },
    { label: 'Avg complexity', value: avgComplexity.toFixed(1), color: colors.textPrimary },
    {
      label: 'Complex functions',
      value: String(complexCount),
      color: complexCount > 0 ? colors.danger : colors.success,
    },
    { label: 'Max call depth', value: String(maxDepth), color: colors.textPrimary },
  ]
}

/** An at-a-glance health summary above the ranked list -- four small
 * stat tiles, hand-rolled from `theme.ts`'s existing tokens (no charting
 * library is installed, and none is needed for four numbers). */
export function SummaryStatsHeader({ scores }: SummaryStatsHeaderProps) {
  const stats = computeStats(scores)

  return (
    <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
      {stats.map((stat) => (
        <div
          key={stat.label}
          style={{
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            padding: `${spacing.sm}px ${spacing.md}px`,
            minWidth: 100,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: stat.color }}>{stat.value}</div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{stat.label}</div>
        </div>
      ))}
    </div>
  )
}
