import { useMemo, useState } from 'react'
import type { DependencyRisk } from '../api/types'
import { colors, radius, spacing } from '../theme'
import { RankedDependencyRow } from './RankedDependencyRow'

interface DependencyRiskReportPaneProps {
  risks: DependencyRisk[]
  selectedPackage: string | null
  onSelectPackage: (packageName: string) => void
}

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

// A responsive tile grid, not a vertical list -- reuses the same
// `repeat(auto-fit, minmax(240px, 1fr))` pattern `DemoRepoPicker.tsx`
// already established for card grids, rather than inventing a new one. The
// packages here are bounded by what a manifest declares, realistically
// never near a virtualization threshold, so no `VirtualList` either.
export function DependencyRiskReportPane({
  risks,
  selectedPackage,
  onSelectPackage,
}: DependencyRiskReportPaneProps) {
  const [query, setQuery] = useState('')

  // Vulnerable-first: a scan of thirty clean packages shouldn't bury the
  // two that actually matter behind alphabetical order.
  const sorted = useMemo(
    () =>
      [...risks].sort((a, b) => {
        const byVulnCount = b.vulnerabilities.length - a.vulnerabilities.length
        return byVulnCount !== 0 ? byVulnCount : a.package.localeCompare(b.package)
      }),
    [risks],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((risk) => risk.package.toLowerCase().includes(q))
  }, [sorted, query])

  const summary = useMemo(() => {
    const vulnerableCount = risks.filter((risk) => risk.vulnerabilities.length > 0).length
    const advisoryCount = risks.reduce((sum, risk) => sum + risk.vulnerabilities.length, 0)
    return { packageCount: risks.length, vulnerableCount, advisoryCount }
  }, [risks])

  if (risks.length === 0) {
    return (
      <p style={{ color: colors.textMuted }}>
        No packages this repo actually imports matched a declared dependency.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <p style={{ margin: `0 0 ${spacing.sm}px`, fontSize: 11, color: colors.textMuted }}>
        {summary.packageCount} package{summary.packageCount === 1 ? '' : 's'} scanned ·{' '}
        <span style={{ color: summary.vulnerableCount > 0 ? colors.danger : colors.success }}>
          {summary.vulnerableCount} with known vulnerabilities
        </span>{' '}
        · {summary.advisoryCount} total advisor{summary.advisoryCount === 1 ? 'y' : 'ies'}
      </p>
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: spacing.sm,
          }}
        >
          {visible.map((risk) => (
            <RankedDependencyRow
              key={risk.package}
              risk={risk}
              selected={risk.package === selectedPackage}
              onSelect={() => onSelectPackage(risk.package)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
