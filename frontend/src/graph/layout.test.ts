import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { layoutGraph } from './layout'

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
})
