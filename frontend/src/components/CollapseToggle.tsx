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

  return (
    <button
      type="button"
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${paneName}`}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid #334155',
        borderRadius: 4,
        color: '#94a3b8',
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
