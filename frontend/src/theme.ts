/** Semantic Vision design tokens -- "Signal Indigo," approved 2026-08-28
 * (see the brand-identity style tile from that pass). Covers the
 * "structural" colors (backgrounds/borders/text), spacing, radius, and
 * typography that were previously either independently hand-typed as hex
 * literals across ~18 component files, or not tokenized at all.
 * Domain-specific palettes (`graph/nodeTypes.tsx`'s `KIND_COLORS`,
 * `flowchart/nodeTypes.tsx`'s `FLOW_KIND_COLORS`, the edge-color maps,
 * `graph/heatmap.ts`'s complexity colors) deliberately stay as their own
 * tables in their own files -- each is already self-contained, not
 * duplicated elsewhere, so folding them in here would just be indirection
 * without removing any real duplication. Those get their own pass in a
 * later phase of this redesign, not this one.
 *
 * Values are OKLCH: perceptually uniform lightness/chroma, so tints of the
 * same hue (accent, accentStrong, accentSoftBg) actually read as "the same
 * color, different weight" rather than hand-picked hexes that drift in
 * apparent saturation. Every accent-family token shares hue 291
 * (violet-indigo); every neutral shares hue 265 (cool blue-slate) at
 * near-zero chroma. */

const palette = {
  // Neutral / slate -- cool blue-slate, hue 265.
  slate950: 'oklch(0.16 0.007 265)',
  slate900: 'oklch(0.205 0.009 265)',
  slate850: 'oklch(0.245 0.010 265)',
  slate700: 'oklch(0.33 0.012 265)',
  slate600: 'oklch(0.27 0.010 265)',
  slate500: 'oklch(0.45 0.012 265)',
  slate400: 'oklch(0.58 0.013 265)',
  slate300: 'oklch(0.74 0.012 265)',
  slate200: 'oklch(0.85 0.008 265)',
  slate50: 'oklch(0.97 0.004 265)',

  // Accent -- violet-indigo, hue 291.
  indigo700: 'oklch(0.53 0.20 291)',
  indigo500: 'oklch(0.635 0.19 291)',
  indigoBg: 'oklch(0.30 0.08 291)',
  indigoText: 'oklch(0.85 0.06 291)',

  // A second, distinct accent hue -- teal, hue 200 -- reserved for a
  // secondary "this toggle is active" state (`dataSourceActiveBg`) that
  // deliberately reads as different from the primary indigo accent, not a
  // dimmer version of it. The runner-up hue from the brand-identity
  // exploration (see "Structural Teal" on the style tile's reference
  // page), kept alive here rather than discarded.
  teal700: 'oklch(0.48 0.09 200)',

  // A warm amber-orange, hue 55 -- reserved for `complexityActiveBg`,
  // distinct from both the primary accent and the `warning` semantic
  // (hue 80) so "complexity view is on" doesn't visually collide with an
  // actual warning banner.
  amber700: 'oklch(0.48 0.13 55)',

  // Semantic hues, all sharing chroma/lightness pairings so they read as
  // one consistent "status color" family, varying only in hue.
  red300: 'oklch(0.72 0.16 25)',
  green300: 'oklch(0.72 0.15 152)',
  green700: 'oklch(0.27 0.06 152)',
  amber300: 'oklch(0.80 0.15 80)',
  amber800: 'oklch(0.30 0.06 80)',
  amber200: 'oklch(0.85 0.10 80)',
} as const

export const colors = {
  bgPage: palette.slate950,
  bgPanel: palette.slate900,
  border: palette.slate700,
  borderSubtle: palette.slate600,
  textPrimary: palette.slate50,
  textFaint: palette.slate200,
  textMuted: palette.slate300,
  textDim: palette.slate400,
  danger: palette.red300,
  success: palette.green300,
  successBg: palette.green700,
  matchHighlight: palette.amber300,
  disabled: palette.slate500,
  accent: palette.indigo500,
  accentStrong: palette.indigo700,
  complexityActiveBg: palette.amber700,
  dataSourceActiveBg: palette.teal700,
  /** Selected sidebar-tree row background, and the "expand blocked" info
   * banner's background on the canvas -- deliberately the accent hue,
   * dimmed, rather than a separate blue: a selected/active row should read
   * as "the brand accent, quiet," not as an unrelated info-blue. */
  infoBg: palette.indigoBg,
  infoText: palette.indigoText,
  /** "Large graph, rendering may be slow" banner background/text. */
  warningBg: palette.amber800,
  warningText: palette.amber200,
  /** Keyboard focus-visible ring (index.css). Same value as `accent` --
   * kept as its own name because "what focus rings use" and "what the
   * primary accent is" are independent facts that happen to currently
   * agree, not the same fact. */
  focusRing: palette.indigo500,
} as const

/** 4px-based spacing scale. Not yet consumed anywhere -- today's ~160
 * inline `style={{}}` blocks across the app hand-write their own
 * padding/gap values. Landing this now so the next redesign pass has a
 * scale to migrate onto, one component at a time, instead of inventing
 * numbers per file as it goes. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

/** Border-radius scale. Same not-yet-consumed status as `spacing` above. */
export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 20,
  full: 9999,
} as const

/** Font stacks. `ui` needs `@fontsource/inter` imported once (see
 * `main.tsx`) -- self-hosted rather than a Google Fonts `<link>`, so
 * typography doesn't add a network dependency to a tool whose whole pitch
 * is running 100% locally. Fallbacks are chosen to be metric-close to
 * Inter/JetBrains Mono so a first paint before the webfont loads doesn't
 * visibly reflow. */
export const font = {
  ui: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const
