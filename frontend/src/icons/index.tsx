/** Semantic Vision's line-icon set -- the in-app replacement for the raw
 * emoji section markers (🕸️ 💥 🧭 🌡️ 📝 🔗 ⚡) used in marketing copy.
 * Approved as part of the "Signal Indigo" brand identity pass (see
 * `theme.ts`'s header comment); one consistent stroke style (20px grid,
 * 1.5 stroke-width, round caps/joins) rather than per-platform emoji
 * rendering, which was the actual "doesn't read as product-grade" problem
 * -- emoji glyphs render differently across OS/browser and can't take a
 * brand color.
 *
 * Every icon defaults to `currentColor` for its stroke, so a consumer sets
 * `color` (via `style`/className) rather than passing a color prop --
 * standard for line-icon sets, and means one icon works unchanged in an
 * active-state, muted, or on-accent-background context. */

import type { CSSProperties } from 'react'

export interface IconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 20 20',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

/** Call graph -- structure, imports, calls. */
export function CallGraphIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <circle cx="5" cy="5" r="2.2" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="9" cy="16" r="2" />
      <line x1="6.6" y1="6.2" x2="13.7" y2="7.4" />
      <line x1="6" y1="6.9" x2="8.3" y2="14.4" />
      <line x1="14.2" y1="8.7" x2="10" y2="14.4" />
    </svg>
  )
}

/** Impact analysis -- blast radius. */
export function ImpactAnalysisIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="4.6" />
      <circle cx="10" cy="10" r="7.6" strokeOpacity="0.55" />
    </svg>
  )
}

/** Execution flowcharts -- branches & loops. */
export function ExecutionFlowchartIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <rect x="7" y="2" width="6" height="4" rx="1" />
      <path d="M10 6 V8" />
      <rect x="4.5" y="8.5" width="5.5" height="4" rx="1" transform="rotate(45 7.25 10.5)" />
      <path d="M10 12 V14" />
      <rect x="7" y="14" width="6" height="4" rx="1" />
    </svg>
  )
}

/** Complexity report -- ranked hotspots. */
export function ComplexityReportIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <line x1="4.5" y1="16" x2="4.5" y2="11" />
      <line x1="10" y1="16" x2="10" y2="7" />
      <line x1="15.5" y1="16" x2="15.5" y2="4" />
    </svg>
  )
}

/** AI documentation -- generated on demand. */
export function AiDocsIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <rect x="4" y="2.5" width="10" height="15" rx="1.4" />
      <line x1="6.5" y1="6.5" x2="11.5" y2="6.5" />
      <line x1="6.5" y1="9.5" x2="11.5" y2="9.5" />
      <line x1="6.5" y1="12.5" x2="9.5" y2="12.5" />
      <path d="M14.5 3.5 L16 5 L17 4 L15.5 2.5 Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Code-to-data lineage -- tables & dbt models. */
export function DataLineageIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <path d="M5 6.5 C5 5.2 6.6 4.2 9 4.2 C11.4 4.2 13 5.2 13 6.5 C13 7.8 11.4 8.8 9 8.8 C6.6 8.8 5 7.8 5 6.5 Z" />
      <path d="M5 6.5 V12.5 C5 13.8 6.6 14.8 9 14.8 C11.4 14.8 13 13.8 13 12.5 V6.5" />
      <path d="M9 9.6 V11.6" strokeOpacity="0.55" />
      <line x1="14.5" y1="10" x2="17.5" y2="10" />
      <line x1="16" y1="8.5" x2="16" y2="11.5" />
    </svg>
  )
}

/** Fast, local, private -- 100% on your machine. */
export function FastLocalPrivateIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <path d="M11 2.5 L5.5 11.5 H9.5 L8 17.5 L15 8.5 H10.5 Z" strokeLinejoin="round" />
    </svg>
  )
}
