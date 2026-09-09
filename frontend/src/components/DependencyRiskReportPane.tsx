import { useMemo, useState } from 'react'
import type { DependencyRisk } from '../api/types'
import { colors, radius, spacing } from '../theme'
import { RankedDependencyRow } from './RankedDependencyRow'

interface DependencyRiskReportPaneProps {
  risks: DependencyRisk[]
}

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

// Plain list, not `VirtualList` -- unlike a function list (which can run
// into the thousands), the packages here are bounded by what a manifest
// declares, realistically never near `VIRTUALIZE_THRESHOLD`. See
// `RankedDependencyRow`'s own docstring for the rest of the reasoning.
export function DependencyRiskReportPane({ risks }: DependencyRiskReportPaneProps) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return risks
    return risks.filter((risk) => risk.package.toLowerCase().includes(q))
  }, [risks, query])

  if (risks.length === 0) {
    return (
      <p style={{ color: colors.textMuted }}>
        No packages this repo actually imports matched a declared dependency.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ marginBottom: spacing.sm }}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by package name"
          aria-label="Filter packages"
          style={{ ...controlStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      {visible.length === 0 ? (
        <p style={{ color: colors.textMuted }}>No packages match this filter.</p>
      ) : (
        visible.map((risk) => <RankedDependencyRow key={risk.package} risk={risk} />)
      )}
    </div>
  )
}
