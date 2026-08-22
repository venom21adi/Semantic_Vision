import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../api/types'
import {
  DEFAULT_COLLAPSE_CHILD_THRESHOLD,
  buildTree,
  collectMatchIds,
  collectVisiblePath,
  isExpandedByDefault,
} from './buildTree'

function node(id: string, kind: GraphNode['kind'], label = id): GraphNode {
  return { id, kind, label, file: 'app.py', line_start: 1, line_end: 1 }
}

function defines(source: string, target: string): GraphEdge {
  return { source, target, kind: 'defines', external: false, ambiguous: false }
}

describe('buildTree', () => {
  it('nests file -> class -> method following defines edges', () => {
    const nodes = [
      node('app.py', 'file', 'app.py'),
      node('app.py::Greeter', 'class', 'Greeter'),
      node('app.py::Greeter.greet', 'function', 'greet'),
    ]
    const edges = [defines('app.py', 'app.py::Greeter'), defines('app.py::Greeter', 'app.py::Greeter.greet')]

    const tree = buildTree(nodes, edges)

    expect(tree).toHaveLength(1)
    expect(tree[0].node.id).toBe('app.py')
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].node.id).toBe('app.py::Greeter')
    expect(tree[0].children[0].children[0].node.id).toBe('app.py::Greeter.greet')
  })

  it('treats nodes with no incoming defines edge as roots', () => {
    const nodes = [node('a.py', 'file'), node('b.py', 'file')]
    const tree = buildTree(nodes, [])

    expect(tree.map((t) => t.node.id).sort()).toEqual(['a.py', 'b.py'])
  })

  it('sorts siblings alphabetically by label', () => {
    const nodes = [node('pkg', 'directory'), node('pkg/z.py', 'file', 'z.py'), node('pkg/a.py', 'file', 'a.py')]
    const edges = [defines('pkg', 'pkg/z.py'), defines('pkg', 'pkg/a.py')]

    const tree = buildTree(nodes, edges)

    expect(tree[0].children.map((c) => c.node.label)).toEqual(['a.py', 'z.py'])
  })

  it('ignores non-defines edges when building hierarchy', () => {
    const nodes = [node('a.py', 'file'), node('a.py::f', 'function', 'f')]
    const edges: GraphEdge[] = [
      { source: 'a.py::f', target: 'external::os.getcwd', kind: 'calls', external: true, ambiguous: false },
    ]

    const tree = buildTree(nodes, edges)

    // `f` isn't reachable via a defines edge, so it's its own root, not
    // nested under a.py.
    expect(tree.map((t) => t.node.id).sort()).toEqual(['a.py', 'a.py::f'])
  })
})

describe('isExpandedByDefault', () => {
  it('collapses a directory with more than the threshold of children', () => {
    const many = Array.from({ length: DEFAULT_COLLAPSE_CHILD_THRESHOLD + 1 }, (_, i) => ({
      node: node(`dir/f${i}.py`, 'file'),
      children: [],
    }))
    const dirItem = { node: node('dir', 'directory'), children: many }

    expect(isExpandedByDefault(dirItem)).toBe(false)
  })

  it('expands a directory at or under the threshold', () => {
    const few = Array.from({ length: DEFAULT_COLLAPSE_CHILD_THRESHOLD }, (_, i) => ({
      node: node(`dir/f${i}.py`, 'file'),
      children: [],
    }))
    const dirItem = { node: node('dir', 'directory'), children: few }

    expect(isExpandedByDefault(dirItem)).toBe(true)
  })

  it('is unaffected by child count for non-directory kinds', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      node: node(`app.py::m${i}`, 'function'),
      children: [],
    }))
    const classItem = { node: node('app.py::Big', 'class'), children: many }

    expect(isExpandedByDefault(classItem)).toBe(true)
  })
})

describe('collectMatchIds', () => {
  const nodes = [node('app.py', 'file'), node('app.py::greet', 'function', 'greet')]
  const tree = buildTree(nodes, [defines('app.py', 'app.py::greet')])

  it('returns an empty set for a blank query', () => {
    expect(collectMatchIds(tree, '  ')).toEqual(new Set())
  })

  it('matches case-insensitively on label', () => {
    expect(collectMatchIds(tree, 'GREET')).toEqual(new Set(['app.py::greet']))
  })
})

describe('collectVisiblePath', () => {
  const nodes = [
    node('app.py', 'file'),
    node('app.py::Greeter', 'class', 'Greeter'),
    node('app.py::Greeter.greet', 'function', 'greet'),
  ]
  const tree = buildTree(nodes, [
    defines('app.py', 'app.py::Greeter'),
    defines('app.py::Greeter', 'app.py::Greeter.greet'),
  ])

  it('returns null when there are no matches (no active filter)', () => {
    expect(collectVisiblePath(tree, new Set())).toBeNull()
  })

  it('includes the match and every ancestor down to it', () => {
    const visible = collectVisiblePath(tree, new Set(['app.py::Greeter.greet']))

    expect(visible).toEqual(new Set(['app.py', 'app.py::Greeter', 'app.py::Greeter.greet']))
  })

  it('does not include unrelated siblings', () => {
    const withSibling = buildTree(
      [...nodes, node('app.py::other', 'function', 'other')],
      [
        defines('app.py', 'app.py::Greeter'),
        defines('app.py::Greeter', 'app.py::Greeter.greet'),
        defines('app.py', 'app.py::other'),
      ],
    )

    const visible = collectVisiblePath(withSibling, new Set(['app.py::Greeter.greet']))

    expect(visible?.has('app.py::other')).toBe(false)
  })
})
