import { colors, radius, spacing } from '../theme'

export interface LogoMarkProps {
  size?: number
  /** Renders just the three-node glyph with no badge background --
   * for contexts already providing their own surface (e.g. a favicon
   * export), as opposed to `Logo` below, which always wraps it in one. */
  bare?: boolean
}

/** The three-node graph glyph at the center of Semantic Vision's mark --
 * the product's whole identity is call graphs, so the mark is one. Kept
 * separate from `Logo` (which adds the badge background + wordmark) so a
 * favicon/social-preview export can use the glyph alone. */
export function LogoMark({ size = 24, bare = false }: LogoMarkProps) {
  const glyph = (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <line x1="6" y1="6" x2="18" y2="9" stroke={colors.accent} strokeWidth="1.4" />
      <line x1="6" y1="6" x2="11" y2="19" stroke={colors.accent} strokeWidth="1.4" />
      <line x1="18" y1="9" x2="11" y2="19" stroke={colors.accent} strokeWidth="1.4" />
      <circle cx="6" cy="6" r="3" fill={colors.bgPanel} stroke={colors.accent} strokeWidth="1.6" />
      <circle cx="18" cy="9" r="2.4" fill={colors.bgPanel} stroke={colors.accent} strokeWidth="1.6" />
      <circle cx="11" cy="19" r="2.4" fill={colors.bgPanel} stroke={colors.accent} strokeWidth="1.6" />
    </svg>
  )
  if (bare) return glyph
  const badgeSize = Math.round(size * 1.73)
  return (
    <div
      style={{
        width: badgeSize,
        height: badgeSize,
        borderRadius: radius.lg,
        background: colors.bgPanel,
        border: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  )
}

export interface LogoProps {
  /** Badge + glyph size passed through to `LogoMark`. */
  markSize?: number
  /** Omit the "See what your code actually does." line -- e.g. for a
   * compact header where only the wordmark fits. */
  tagline?: boolean
}

/** The full lockup: mark + "Semantic Vision" wordmark, optionally with the
 * tagline underneath. The one place both halves of the brand identity are
 * assembled together, so every surface that needs the logo (app header,
 * a future landing page) renders identically rather than each hand-laying
 * it out. */
export function Logo({ markSize = 26, tagline = true }: LogoProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.lg }}>
      <LogoMark size={markSize} />
      <div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
            color: colors.textPrimary,
          }}
        >
          Semantic Vision
        </div>
        {tagline && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            See what your code actually does.
          </div>
        )}
      </div>
    </div>
  )
}
