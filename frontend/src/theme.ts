/** Shared UI-chrome color tokens. Not a full design system -- this
 * covers the "structural" colors (backgrounds/borders/text) that were
 * independently hand-typed as hex literals across ~18 component files,
 * including at least one exact literal (`#1e3a5f`) duplicated verbatim
 * in two unrelated files. Domain-specific palettes (`graph/nodeTypes.tsx`'s
 * `KIND_COLORS`, `flowchart/nodeTypes.tsx`'s `FLOW_KIND_COLORS`, the
 * edge-color maps, `graph/heatmap.ts`'s complexity colors) deliberately
 * stay as their own tables in their own files -- each is already
 * self-contained, not duplicated elsewhere, so folding them in here
 * would just be indirection without removing any real duplication. */

const palette = {
  slate900: '#0f172a',
  slate800: '#1e293b',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748b',
  slate400: '#94a3b8',
  slate300: '#cbd5e1',
  slate50: '#f8fafc',
  red300: '#fca5a5',
  amber300: '#fbbf24',
  amber700: '#b45309',
  green300: '#86efac',
  green700: '#15803d',
  blue600: '#2563eb',
  blue700: '#1d4ed8',
  blue900: '#1e3a5f',
  blue200: '#bfdbfe',
  teal700: '#0e7490',
} as const

export const colors = {
  bgPage: palette.slate900,
  bgPanel: palette.slate800,
  border: palette.slate700,
  borderSubtle: palette.slate600,
  hoverBg: palette.slate700,
  textPrimary: palette.slate50,
  textMuted: palette.slate400,
  textDim: palette.slate500,
  textFaint: palette.slate300,
  danger: palette.red300,
  success: palette.green300,
  successBg: palette.green700,
  matchHighlight: palette.amber300,
  disabled: palette.slate600,
  accent: palette.blue600,
  accentStrong: palette.blue700,
  complexityActiveBg: palette.amber700,
  dataSourceActiveBg: palette.teal700,
  /** Selected sidebar-tree row background, and the "expand blocked" info
   * banner's background on the canvas -- the same literal was
   * independently hardcoded in both `components/Tree.tsx` and
   * `graph/GraphCanvas.tsx`; reused here as one "emphasized info surface"
   * token rather than two coincidentally-identical ones. */
  infoBg: palette.blue900,
  infoText: palette.blue200,
  /** "Large graph, rendering may be slow" banner background/text --
   * today independently hardcoded as the same pair of literals in both
   * `graph/GraphCanvas.tsx` and `flowchart/FlowchartCanvas.tsx`. */
  warningBg: '#7c2d12',
  warningText: '#fed7aa',
  /** Keyboard focus-visible ring (graph/interaction.css) -- new, backed
   * no existing UI element before this polish pass. */
  focusRing: palette.blue600,
} as const
