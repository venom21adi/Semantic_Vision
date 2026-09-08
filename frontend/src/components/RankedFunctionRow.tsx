import type { GraphNode } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { KIND_COLORS } from '../graph/nodeTypes'
import { colors, radius, spacing } from '../theme'

/** Every row's fixed height, in px -- name line + file line + one badge
 * line + vertical padding/margin, all rounded up with a little slack.
 * Exported so `VirtualList` (see the report panes that use it) can window
 * rows without measuring each one's real DOM height, which only works if
 * every row actually renders at this exact height -- see the badges row's
 * `flexWrap: 'nowrap'` below, which is what keeps it true. */
export const ROW_HEIGHT = 68

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
    <Wrapper
      {...(disabled ? {} : { type: 'button', onClick: onSelect })}
      // `.sv-interactive`'s hover brightening is gated on `:not(:disabled)`,
      // which only ever matches real form controls -- it's always true for
      // a `<div>`, so applying this class here would brighten on hover
      // exactly like a live row despite `cursor: default` below. Only the
      // clickable `<button>` variant gets it.
      className={disabled ? undefined : 'sv-interactive'}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'flex-start',
        gap: spacing.sm,
        textAlign: 'left',
        background: selected ? colors.infoBg : colors.bgPanel,
        border: `1px solid ${selected ? colors.accent : colors.border}`,
        borderRadius: radius.md,
        padding: `${spacing.sm}px ${spacing.md}px`,
        marginBottom: spacing.xs,
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
          // `flexWrap: 'nowrap'` + `overflow: hidden` (not `'wrap'`) so
          // this row always renders at exactly `ROW_HEIGHT` regardless of
          // how many badges it has or how narrow the column is -- a
          // second wrapped line would silently push this row's true
          // height past what `VirtualList` assumes every row occupies,
          // which reads as rows drifting out of alignment/overlapping as
          // the list scrolls, not just a clipped badge.
          <div style={{ display: 'flex', flexWrap: 'nowrap', overflow: 'hidden', gap: 4, marginTop: 5 }}>
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
                  flexShrink: 0,
                }}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </span>
    </Wrapper>
  )
}
