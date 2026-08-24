/** Scaled down from McCabe's own published complexity bands (1-10
 * simple, 11-20 moderate, 21+ complex) since this project's own
 * functions skew much smaller in practice -- the raw McCabe bands would
 * leave nearly every real function looking "simple" and the overlay
 * useless for spotting anything.
 */
export const SIMPLE_MAX = 3
export const MODERATE_MAX = 7

export const SIMPLE_COLOR = '#15803d'
export const MODERATE_COLOR = '#ca8a04'
export const COMPLEX_COLOR = '#b91c1c'

export function complexityToColor(cyclomaticComplexity: number): string {
  if (cyclomaticComplexity <= SIMPLE_MAX) return SIMPLE_COLOR
  if (cyclomaticComplexity <= MODERATE_MAX) return MODERATE_COLOR
  return COMPLEX_COLOR
}
