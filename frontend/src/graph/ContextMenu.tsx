import { useEffect, useRef } from 'react'
import { colors } from '../theme'

export interface ContextMenuTarget {
  nodeId: string
  label: string
  x: number
  y: number
}

interface ContextMenuProps {
  target: ContextMenuTarget
  onClose: () => void
  onDocument: (nodeId: string) => void
  onImpactAnalysis: (nodeId: string) => void
  onViewSource: (nodeId: string) => void
  onExecutionFlowchart: (nodeId: string) => void
}

export function ContextMenu({
  target,
  onClose,
  onDocument,
  onImpactAnalysis,
  onViewSource,
  onExecutionFlowchart,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as globalThis.Node)) {
        onClose()
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const items = [
    { label: 'Document', action: onDocument },
    { label: 'Impact Analysis', action: onImpactAnalysis },
    { label: 'View Source', action: onViewSource },
    { label: 'Execution Flowchart', action: onExecutionFlowchart },
  ]

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${target.label}`}
      style={{
        position: 'fixed',
        top: target.y,
        left: target.x,
        background: colors.bgPanel,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        padding: 4,
        minWidth: 160,
        zIndex: 1000,
        fontSize: 13,
      }}
    >
      <div style={{ padding: '4px 8px', color: colors.textMuted, fontSize: 11 }}>{target.label}</div>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            item.action(target.nodeId)
            onClose()
          }}
          className="sv-menu-item"
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            border: 'none',
            color: colors.textPrimary,
            padding: '6px 8px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
