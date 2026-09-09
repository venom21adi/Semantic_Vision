import type { DependencyRisk } from '../api/types'
import { colors, radius, spacing } from '../theme'

// Tiles are narrower than the old full-width cards -- capping badges here
// keeps a heavily-vulnerable package's tile from growing much taller than
// its neighbors in the grid. The full, uncapped list is always available in
// `CodeHealthDetail`'s canvas header once this tile is selected.
const MAX_VULNERABILITY_BADGES = 4

interface RankedDependencyRowProps {
  risk: DependencyRisk
  selected: boolean
  onSelect: () => void
}

/** One grid tile in `DependencyRiskReportPane`. Package-keyed, not
 * `GraphNode`-keyed -- a package isn't a graph node, so this can't reuse
 * `RankedFunctionRow` directly, though it mirrors that component's
 * selected/onSelect shape. Selecting a tile drives `CodeHealthDetail`'s
 * canvas: it renders `PackageImportersGraph` for whichever package is
 * selected, showing which of this repo's own files actually import it --
 * so a package's vulnerability badges here link out to osv.dev, while
 * clicking the tile itself answers "where in my code am I exposed to
 * this." */
export function RankedDependencyRow({ risk, selected, onSelect }: RankedDependencyRowProps) {
  const hasVulnerabilities = risk.vulnerabilities.length > 0
  const shownVulnerabilities = risk.vulnerabilities.slice(0, MAX_VULNERABILITY_BADGES)
  const hiddenCount = risk.vulnerabilities.length - shownVulnerabilities.length

  return (
    <button
      type="button"
      onClick={onSelect}
      className="sv-interactive"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.xs,
        background: selected ? colors.infoBg : colors.bgPanel,
        border: `1px solid ${selected ? colors.accent : hasVulnerabilities ? colors.danger : colors.border}`,
        borderRadius: radius.md,
        padding: `${spacing.sm}px ${spacing.md}px`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing.xs, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
          {risk.package}
        </span>
        <span style={{ fontSize: 11, color: colors.textDim }}>
          {risk.version ?? 'unknown version'} · {risk.ecosystem}
        </span>
      </div>
      {hasVulnerabilities ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {shownVulnerabilities.map((vuln) => (
            <span
              key={vuln.id}
              title={vuln.id}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: radius.full,
                border: `1px solid ${colors.danger}`,
                color: colors.danger,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 120,
              }}
            >
              {vuln.id}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, padding: '1px 4px' }}>
              +{hiddenCount} more
            </span>
          )}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: colors.success }}>No known vulnerabilities</span>
      )}
    </button>
  )
}
