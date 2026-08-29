import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH, resolveNodeOverlaps } from './layout'

describe('layoutGraph', () => {
  it('assigns a distinct position to every node', () => {
    const nodes: Node[] = [
      { id: 'a', type: 'file', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'function', position: { x: 0, y: 0 }, data: {} },
      { id: 'c', type: 'function', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'a-c', source: 'a', target: 'c' },
    ]

    const positioned = layoutGraph(nodes, edges)

    expect(positioned).toHaveLength(3)
    const positions = positioned.map((node) => `${node.position.x},${node.position.y}`)
    expect(new Set(positions).size).toBe(3)
  })

  it('preserves node ids and data', () => {
    const nodes: Node[] = [
      { id: 'only', type: 'file', position: { x: 0, y: 0 }, data: { label: 'x' } },
    ]

    const positioned = layoutGraph(nodes, [])

    expect(positioned[0].id).toBe('only')
    expect(positioned[0].data).toEqual({ label: 'x' })
  })

  it('ignores an edge whose source or target has no corresponding node, rather than implicitly laying it out', () => {
    // graphlib's own `setEdge` auto-creates any endpoint it hasn't seen
    // via `setNode` -- without filtering these out first, an edge to an
    // external/unlisted symbol (never actually rendered as a node) would
    // silently hand dagre extra work per distinct dangling target.
    const nodes: Node[] = [{ id: 'a', type: 'file', position: { x: 0, y: 0 }, data: {} }]
    const edges: Edge[] = [
      { id: 'a-external', source: 'a', target: 'external::numpy' },
      { id: 'nowhere-a', source: 'nowhere', target: 'a' },
    ]

    const positioned = layoutGraph(nodes, edges)

    expect(positioned).toHaveLength(1)
    expect(positioned[0].id).toBe('a')
    expect(Number.isFinite(positioned[0].position.x)).toBe(true)
    expect(Number.isFinite(positioned[0].position.y)).toBe(true)
  })
})

describe('resolveNodeOverlaps', () => {
  function node(id: string, x: number, y: number): Node {
    return { id, type: 'function', position: { x, y }, data: {} }
  }

  it('leaves nodes alone when nothing overlaps', () => {
    const nodes = [node('a', 0, 0), node('b', 1000, 1000)]

    const resolved = resolveNodeOverlaps(nodes, new Set())

    expect(resolved).toEqual(nodes)
  })

  it('nudges a movable node straight down until it clears a fixed one', () => {
    const nodes = [node('fixed', 0, 0), node('movable', 0, 0)]

    const resolved = resolveNodeOverlaps(nodes, new Set(['fixed']))

    const fixed = resolved.find((n) => n.id === 'fixed')!
    const movable = resolved.find((n) => n.id === 'movable')!
    expect(fixed.position).toEqual({ x: 0, y: 0 })
    expect(movable.position.x).toBe(0)
    expect(movable.position.y).toBeGreaterThanOrEqual(NODE_HEIGHT)
    // No longer overlapping the fixed node's bounding box.
    expect(Math.abs(movable.position.y - fixed.position.y)).toBeGreaterThanOrEqual(NODE_HEIGHT)
  })

  it('never moves a fixed node, even if two fixed nodes already overlap', () => {
    const nodes = [node('fixed-a', 5, 5), node('fixed-b', 5, 5)]

    const resolved = resolveNodeOverlaps(nodes, new Set(['fixed-a', 'fixed-b']))

    expect(resolved).toEqual(nodes)
  })

  it('keeps nudging past multiple stacked fixed nodes in its path', () => {
    const nodes = [node('fixed-a', 0, 0), node('fixed-b', 0, NODE_HEIGHT + 24), node('movable', 0, 0)]

    const resolved = resolveNodeOverlaps(nodes, new Set(['fixed-a', 'fixed-b']))

    const movable = resolved.find((n) => n.id === 'movable')!
    for (const fixed of resolved.filter((n) => n.id !== 'movable')) {
      const clearsX = Math.abs(movable.position.x - fixed.position.x) >= NODE_WIDTH + 24
      const clearsY = Math.abs(movable.position.y - fixed.position.y) >= NODE_HEIGHT + 24
      expect(clearsX || clearsY).toBe(true)
    }
  })

  it('preserves input order and untouched node fields', () => {
    const nodes = [
      { ...node('fixed', 0, 0), data: { label: 'fixed-label' } },
      { ...node('movable', 0, 0), data: { label: 'movable-label' } },
    ]

    const resolved = resolveNodeOverlaps(nodes, new Set(['fixed']))

    expect(resolved.map((n) => n.id)).toEqual(['fixed', 'movable'])
    expect(resolved[1].data).toEqual({ label: 'movable-label' })
  })
})
