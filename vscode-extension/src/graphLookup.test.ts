import { describe, expect, it } from 'vitest'
import { findNodeAtCursor, type GraphNodeLike } from './graphLookup'

function node(id: string, file: string, lineStart: number, lineEnd: number): GraphNodeLike {
  return { id, file, line_start: lineStart, line_end: lineEnd }
}

describe('findNodeAtCursor', () => {
  it('finds the node whose range contains the cursor line', () => {
    const nodes = [node('a.py', 'a.py', 1, 20), node('a.py::greet', 'a.py', 5, 8)]

    expect(findNodeAtCursor(nodes, 'a.py', 6)?.id).toBe('a.py::greet')
  })

  it('returns the innermost match when ranges are nested (a method inside its class)', () => {
    const nodes = [
      node('a.py::Greeter', 'a.py', 1, 20),
      node('a.py::Greeter.greet', 'a.py', 5, 8),
    ]

    expect(findNodeAtCursor(nodes, 'a.py', 6)?.id).toBe('a.py::Greeter.greet')
  })

  it('ignores nodes in a different file even if the line range would match', () => {
    const nodes = [node('b.py::other', 'b.py', 1, 20)]

    expect(findNodeAtCursor(nodes, 'a.py', 6)).toBeNull()
  })

  it('returns null when the cursor line is outside every range', () => {
    const nodes = [node('a.py::greet', 'a.py', 5, 8)]

    expect(findNodeAtCursor(nodes, 'a.py', 100)).toBeNull()
  })

  it('is inclusive at both ends of a range', () => {
    const nodes = [node('a.py::greet', 'a.py', 5, 8)]

    expect(findNodeAtCursor(nodes, 'a.py', 5)?.id).toBe('a.py::greet')
    expect(findNodeAtCursor(nodes, 'a.py', 8)?.id).toBe('a.py::greet')
    expect(findNodeAtCursor(nodes, 'a.py', 4)).toBeNull()
    expect(findNodeAtCursor(nodes, 'a.py', 9)).toBeNull()
  })
})
