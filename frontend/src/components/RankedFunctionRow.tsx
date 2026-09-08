import type { ReactNode } from 'react'
import type { GraphNode } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { KIND_COLORS } from '../graph/nodeTypes'
import { colors, radius, spacing } from '../theme'

export interface RankedFunctionBadge {
  label: string
  /** Omit for a plain neutral badge (e.g. dead-code rows have no metric to
   * shade); set to a `complexityToColor`/severity result to make the badge
   * itself carry the same color the graph canvas and heatmap already use
   * for that number. */
  color?: string
}

interface RankedFunctionRowProps {
  nodeId: string
  /** Looked up from the currently-loaded graph by the caller (see each
   * report pane's `graphNodeById` map) -- `undefined` for a stale id with
   * no matching node, in which case this falls back to the raw id rather
   * than throwing (mirrors `App.tsx`'s `showcaseItems` precedent). */
  graphNode: GraphNode | undefined
  selected: boolean
  onSelect: () => void
  badges: RankedFunctionBadge[]
  /** An optional control docked to the row's right edge -- today only
   * `PerformanceReportPane`'s "show direct callers" drill-down toggle. */
  trailing?: ReactNode
  /** For a diff's "Removed" section (`CodeHealthDetail.tsx`) -- the
   * function no longer exists in the refreshed graph, so selecting it
   * would silently do nothing. Renders dimmed and inert instead of
   * dropping back to a plain, unstyled text row. */
  disabled?: boolean
}

/** The card every ranked list (Complexity/Hotspots/Dead code, all inside
 * `CodeHealthSidebar`) renders one function as -- a kind-colored dot, the
 * function's *pretty* name (never a raw `path/to/file.py::Class.method`
 * id) with its file path underneath, and small colored metric badges.
 * Visual language (bgPanel/border/radius.md) matches `SummaryStatsHeader`'s
 * existing stat tiles rather than inventing a new card style. */
export function RankedFunctionRow({
  nodeId,
  graphNode,
  selected,
  onSelect,
  badges,
  trailing,
  disabled = false,
}: RankedFunctionRowProps) {
  const dotColor = graphNode ? KIND_COLORS[graphNode.kind].background : colors.disabled
  const primaryLabel = graphNode ? formatNodeLabel(graphNode.label, graphNode.accessor_kind) : nodeId
  const secondaryLabel = graphNode?.file

  // A disabled row (a diff's "Removed" section -- the function no longer
  // exists, so selecting it would do nothing) renders as a plain `div`,
  // not a `<button disabled>`: a disabled button still has an accessible
  // `role="button"` and a queryable name, which would make it
  // indistinguishable from a real, clickable row to anything (tests
  // included) checking "is this actually interactive."
  const Wrapper = disabled ? 'div' : 'button'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Wrapper
        {...(disabled ? {} : { type: 'button', onClick: onSelect })}
        // `.sv-interactive`'s hover brightening is gated on `:not(:disabled)`,
        // which only ever matches real form controls -- it's always true for
        // a `<div>`, so applying this class here would brighten on hover
        // exactly like a live row despite `cursor: default` below. Only the
        // clickable `<button>` variant gets it.
        className={disabled ? undefined : 'sv-interactive'}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'flex-start',
          gap: spacing.sm,
          textAlign: 'left',
          background: selected ? colors.infoBg : colors.bgPanel,
          border: `1px solid ${selected ? colors.accent : colors.border}`,
          borderRadius: radius.md,
          padding: `${spacing.sm}px ${spacing.md}px`,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: 2,
            background: dotColor,
            flexShrink: 0,
            marginTop: 4,
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: disabled ? colors.textDim : colors.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={nodeId}
          >
            {primaryLabel}
          </div>
          {secondaryLabel && (
            <div
              style={{
                fontSize: 11,
                color: colors.textDim,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 1,
              }}
            >
              {secondaryLabel}
            </div>
          )}
          {badges.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {badges.map((badge) => (
                <span
                  key={badge.label}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: radius.full,
                    border: `1px solid ${badge.color ?? colors.border}`,
                    color: badge.color ?? colors.textMuted,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </span>
      </Wrapper>
      {trailing}
    </div>
  )
}
