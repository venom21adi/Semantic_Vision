import { colors } from '../theme'

interface CollapseToggleProps {
  collapsed: boolean
  onClick: () => void
  /** Which edge of the app this pane sits against -- controls which way the chevron points. */
  edge: 'left' | 'right'
  paneName: string
}

export function CollapseToggle({ collapsed, onClick, edge, paneName }: CollapseToggleProps) {
  const expandChar = edge === 'left' ? '›' : '‹'
  const collapseChar = edge === 'left' ? '‹' : '›'

  const label = `${collapsed ? 'Expand' : 'Collapse'} ${paneName}`

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="sv-interactive"
      style={{
        background: 'transparent',
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        color: colors.textMuted,
        cursor: 'pointer',
        fontSize: 12,
        lineHeight: 1,
        padding: '4px 6px',
      }}
    >
      {collapsed ? expandChar : collapseChar}
    </button>
  )
}
