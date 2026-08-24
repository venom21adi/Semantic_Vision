import { describe, expect, it } from 'vitest'
import { COMPLEX_COLOR, MODERATE_COLOR, MODERATE_MAX, SIMPLE_COLOR, SIMPLE_MAX, complexityToColor } from './heatmap'

describe('complexityToColor', () => {
  it('maps a trivial score to the simple color', () => {
    expect(complexityToColor(1)).toBe(SIMPLE_COLOR)
  })

  it('maps exactly the simple/moderate boundary to simple', () => {
    expect(complexityToColor(SIMPLE_MAX)).toBe(SIMPLE_COLOR)
  })

  it('maps just past the simple boundary to moderate', () => {
    expect(complexityToColor(SIMPLE_MAX + 1)).toBe(MODERATE_COLOR)
  })

  it('maps exactly the moderate/complex boundary to moderate', () => {
    expect(complexityToColor(MODERATE_MAX)).toBe(MODERATE_COLOR)
  })

  it('maps just past the moderate boundary to complex', () => {
    expect(complexityToColor(MODERATE_MAX + 1)).toBe(COMPLEX_COLOR)
  })

  it('maps a very high score to the complex color', () => {
    expect(complexityToColor(50)).toBe(COMPLEX_COLOR)
  })
})
