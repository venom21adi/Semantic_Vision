import { useEffect, useRef } from 'react'

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
}

export function ContextMenu({
  target,
  onClose,
  onDocument,
  onImpactAnalysis,
  onViewSource,
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
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        padding: 4,
        minWidth: 160,
        zIndex: 1000,
        fontSize: 13,
      }}
    >
      <div style={{ padding: '4px 8px', color: '#94a3b8', fontSize: 11 }}>{target.label}</div>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            item.action(target.nodeId)
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: '#f8fafc',
            padding: '6px 8px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#334155'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
