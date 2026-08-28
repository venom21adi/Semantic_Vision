import { colors, radius } from '../theme'

interface CollapseToggleProps {
  collapsed: boolean
  onClick: () => void
  /** Which edge of the app this pane sits against -- controls which way the chevron points. */
  edge: 'left' | 'right'
  paneName: string
  /** Stretches to fill its container instead of sizing to its own content
   * -- used for the collapsed strip itself, so the whole rail is one
   * clickable target instead of a small button pinned to its top edge
   * with dead space below it. */
  fill?: boolean
}

export function CollapseToggle({ collapsed, onClick, edge, paneName, fill = false }: CollapseToggleProps) {
  const expandChar = edge === 'left' ? '›' : '‹'
  const collapseChar = edge === 'left' ? '‹' : '›'

  const label = `${collapsed ? 'Expand' : 'Collapse'} ${paneName}`

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="sv-interactive sv-collapse-toggle"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: fill ? '100%' : 22,
        height: fill ? '100%' : 22,
        border: `1px solid ${colors.border}`,
        borderRadius: fill ? 0 : radius.sm,
        color: colors.textPrimary,
        cursor: 'pointer',
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
        padding: 0,
      }}
    >
      {collapsed ? expandChar : collapseChar}
    </button>
  )
}
