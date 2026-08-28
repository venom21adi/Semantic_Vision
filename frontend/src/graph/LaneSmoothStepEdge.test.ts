import { describe, expect, it } from 'vitest'
import { isDownwardEdge } from './LaneSmoothStepEdge'

describe('isDownwardEdge', () => {
  it('is true for a normal dagre-layout gap (well over the 40px threshold)', () => {
    expect(isDownwardEdge(100, 300)).toBe(true)
  })

  it('is false once the gap closes to exactly the 40px threshold', () => {
    // Mirrors getSmoothStepPath's own strict "<" comparison on the gapped
    // (offset by 20px each) positions -- a gap of exactly 40 is NOT
    // "downward" by the library's own definition.
    expect(isDownwardEdge(100, 140)).toBe(false)
    expect(isDownwardEdge(100, 141)).toBe(true)
  })

  it('is false for equal Y (a node dragged level with its neighbor)', () => {
    expect(isDownwardEdge(100, 100)).toBe(false)
  })

  it('is false for an upward-pointing edge (target above source, e.g. a circular import)', () => {
    expect(isDownwardEdge(300, 100)).toBe(false)
  })
})
