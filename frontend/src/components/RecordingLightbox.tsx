import { useEffect, useRef } from 'react'
import { colors, radius } from '../theme'

interface RecordingLightboxProps {
  src: string
  alt: string
  onClose: () => void
}

/** Full-screen overlay for a demo recording opened from its small inline
 * preview (DocPane/DataSourcePane's "watch it on a real repo" GIFs) --
 * those render at sidebar width, too small to actually read. Closes on
 * Escape, clicking the backdrop, or the close button; clicking the media
 * itself does nothing, matching ContextMenu.tsx's outside-click pattern
 * (fixed positioning, no portal -- this codebase doesn't use one). */
export function RecordingLightbox({ src, alt, onClose }: RecordingLightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: 'rgba(6, 6, 8, 0.86)',
        cursor: 'zoom-out',
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        aria-label="Close"
        className="sv-interactive"
        style={{
          position: 'fixed',
          top: 20,
          right: 24,
          width: 40,
          height: 40,
          borderRadius: radius.full,
          border: `1px solid ${colors.border}`,
          background: colors.bgPanel,
          color: colors.textFaint,
          fontSize: 20,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'block',
          borderRadius: radius.md,
          border: `1px solid ${colors.border}`,
          boxShadow: '0 30px 80px -20px rgba(0, 0, 0, 0.75)',
          cursor: 'default',
        }}
      />
    </div>
  )
}
