import type { DependencyRisk } from '../api/types'
import { colors, radius, spacing } from '../theme'

interface RankedDependencyRowProps {
  risk: DependencyRisk
}

/** Package-keyed, not `GraphNode`-keyed -- a package isn't a graph node, so
 * this can't reuse `RankedFunctionRow` (which assumes one, for its dot
 * color and click-to-select-on-canvas behavior). No click/selection here
 * either: a package has no neighborhood graph to jump to the way a
 * function does, so vulnerability ids are just links out to osv.dev's own
 * advisory pages instead. Not used inside `VirtualList`: unlike a
 * function list (which can run into the thousands), the packages here are
 * bounded by what a manifest declares, realistically never near
 * `VIRTUALIZE_THRESHOLD` -- and a package's vulnerability badges wrap
 * across multiple lines rather than clipping to one (a package can have
 * many advisories), so this row has no fixed height for a virtualizer to
 * assume in the first place. */
export function RankedDependencyRow({ risk }: RankedDependencyRowProps) {
  const hasVulnerabilities = risk.vulnerabilities.length > 0

  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.xs,
        background: colors.bgPanel,
        border: `1px solid ${hasVulnerabilities ? colors.danger : colors.border}`,
        borderRadius: radius.md,
        padding: `${spacing.sm}px ${spacing.md}px`,
        marginBottom: spacing.xs,
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
          {risk.vulnerabilities.map((vuln) => (
            <a
              key={vuln.id}
              href={`https://osv.dev/vulnerability/${vuln.id}`}
              target="_blank"
              rel="noreferrer"
              className="sv-interactive"
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: radius.full,
                border: `1px solid ${colors.danger}`,
                color: colors.danger,
                textDecoration: 'none',
              }}
            >
              {vuln.id}
            </a>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: colors.success }}>No known vulnerabilities</span>
      )}
    </div>
  )
}
