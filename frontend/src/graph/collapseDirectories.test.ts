import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../api/types'
import { ancestorContainerIds, collapseGraph } from './collapseDirectories'

function node(id: string, kind: GraphNode['kind'], label = id): GraphNode {
  return { id, kind, label, file: 'app.py', line_start: 1, line_end: 1 }
}

function defines(source: string, target: string): GraphEdge {
  return { source, target, kind: 'defines', external: false, ambiguous: false }
}

function calls(
  source: string,
  target: string,
  extra: Partial<GraphEdge> & { count?: number } = {},
): GraphEdge & { count?: number } {
  return { source, target, kind: 'calls', external: false, ambiguous: false, ...extra }
}

describe('collapseGraph', () => {
  it('reproduces the input unchanged when every directory and file is expanded', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
      node('pkg/b.py', 'file', 'b.py'),
    ]
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('pkg', 'pkg/b.py'),
      defines('pkg/a.py', 'pkg/a.py::f'),
      calls('pkg/a.py::f', 'pkg/b.py'),
    ]

    const result = collapseGraph(nodes, edges, new Set(['pkg', 'pkg/a.py', 'pkg/b.py']))

    expect(result.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id))
    expect(result.edges).toEqual(edges)
  })

  it('collapses a directory down to itself, hiding its descendants', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
      node('other.py', 'file'),
    ]
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('pkg/a.py', 'pkg/a.py::f'),
      calls('pkg/a.py::f', 'other.py'),
    ]

    const result = collapseGraph(nodes, edges, new Set())

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['other.py', 'pkg'])
    expect(result.containerState.get('pkg')).toEqual({ expanded: false, hiddenDescendantCount: 2 })
    // The internal `defines` edges (pkg->a.py, a.py->f) collapse into
    // self-loops on `pkg` and are dropped; only the call escaping the
    // collapsed directory survives, remapped to `pkg`.
    expect(result.edges).toEqual([calls('pkg', 'other.py')])
  })

  it('folds a nested collapsed subdirectory into the outermost collapsed ancestor', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/sub', 'directory', 'sub'),
      node('pkg/sub/a.py', 'file', 'a.py'),
    ]
    const edges = [defines('pkg', 'pkg/sub'), defines('pkg/sub', 'pkg/sub/a.py')]

    const result = collapseGraph(nodes, edges, new Set())

    // Not ['pkg', 'pkg/sub'] -- `sub` itself is hidden inside `pkg`, not a
    // second visible bubble.
    expect(result.nodes.map((n) => n.id)).toEqual(['pkg'])
    expect(result.containerState.get('pkg')?.hiddenDescendantCount).toBe(2)
  })

  it('keeps a subdirectory as its own visible node when its parent is expanded but it is not', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/sub', 'directory', 'sub'),
      node('pkg/sub/a.py', 'file', 'a.py'),
    ]
    const edges = [defines('pkg', 'pkg/sub'), defines('pkg/sub', 'pkg/sub/a.py')]

    const result = collapseGraph(nodes, edges, new Set(['pkg']))

    expect(result.nodes.map((n) => n.id)).toEqual(['pkg', 'pkg/sub'])
    expect(result.containerState.get('pkg')).toEqual({ expanded: true, hiddenDescendantCount: 0 })
    expect(result.containerState.get('pkg/sub')).toEqual({ expanded: false, hiddenDescendantCount: 1 })
  })

  it('treats a file as its own collapse boundary, not just directories', () => {
    // A root-level file (no directory parent at all) with several
    // methods -- the case that motivated collapsing files, not just
    // directories: this shape produced a dense, slow-to-lay-out graph on
    // a real large repo when only directories were collapse boundaries.
    const nodes = [
      node('api.py', 'file'),
      node('api.py::TTS', 'class', 'TTS'),
      node('api.py::TTS.tts', 'function', 'tts'),
      node('api.py::TTS.tts_to_file', 'function', 'tts_to_file'),
      node('other.py', 'file'),
    ]
    const edges = [
      defines('api.py', 'api.py::TTS'),
      defines('api.py::TTS', 'api.py::TTS.tts'),
      defines('api.py::TTS', 'api.py::TTS.tts_to_file'),
      calls('api.py::TTS.tts', 'other.py'),
      calls('api.py::TTS.tts_to_file', 'other.py'),
    ]

    const result = collapseGraph(nodes, edges, new Set())

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['api.py', 'other.py'])
    expect(result.containerState.get('api.py')).toEqual({ expanded: false, hiddenDescendantCount: 3 })
    // Both methods' calls to `other.py` remap to the same `api.py`->`other.py`
    // edge and aggregate, rather than staying as two distinct method-level edges.
    expect(result.edges).toEqual([calls('api.py', 'other.py', { count: 2 })])
  })

  it('keeps a file as its own visible node when its directory is expanded but the file is not', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
    ]
    const edges = [defines('pkg', 'pkg/a.py'), defines('pkg/a.py', 'pkg/a.py::f')]

    const result = collapseGraph(nodes, edges, new Set(['pkg']))

    expect(result.nodes.map((n) => n.id)).toEqual(['pkg', 'pkg/a.py'])
    expect(result.containerState.get('pkg/a.py')).toEqual({ expanded: false, hiddenDescendantCount: 1 })
  })

  it('aggregates parallel edges created by remapping into one, with a count', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
      node('pkg/a.py::g', 'function', 'g'),
      node('other.py', 'file'),
    ]
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('pkg/a.py', 'pkg/a.py::f'),
      defines('pkg/a.py', 'pkg/a.py::g'),
      calls('pkg/a.py::f', 'other.py'),
      calls('pkg/a.py::g', 'other.py', { ambiguous: true }),
    ]

    const result = collapseGraph(nodes, edges, new Set())

    const rolledUp = result.edges.find((e) => e.kind === 'calls')
    expect(rolledUp).toEqual({
      source: 'pkg',
      target: 'other.py',
      kind: 'calls',
      external: false,
      ambiguous: true, // OR-combined: at least one underlying edge was ambiguous
      count: 2,
    })
  })

  it('drops a self-loop created when both endpoints collapse into the same directory', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
      node('pkg/b.py', 'file', 'b.py'),
      node('pkg/b.py::g', 'function', 'g'),
    ]
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('pkg', 'pkg/b.py'),
      defines('pkg/a.py', 'pkg/a.py::f'),
      defines('pkg/b.py', 'pkg/b.py::g'),
      calls('pkg/a.py::f', 'pkg/b.py::g'), // both inside `pkg` -- internal
    ]

    const result = collapseGraph(nodes, edges, new Set())

    expect(result.edges.some((e) => e.kind === 'calls')).toBe(false)
  })
})

describe('ancestorContainerIds', () => {
  it('returns every directory/file ancestor, nearest first, skipping non-container kinds', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/sub', 'directory', 'sub'),
      node('pkg/sub/a.py', 'file', 'a.py'),
      node('pkg/sub/a.py::C', 'class', 'C'),
      node('pkg/sub/a.py::C.m', 'function', 'm'),
    ]
    const edges = [
      defines('pkg', 'pkg/sub'),
      defines('pkg/sub', 'pkg/sub/a.py'),
      defines('pkg/sub/a.py', 'pkg/sub/a.py::C'),
      defines('pkg/sub/a.py::C', 'pkg/sub/a.py::C.m'),
    ]

    expect(ancestorContainerIds('pkg/sub/a.py::C.m', nodes, edges)).toEqual([
      'pkg/sub/a.py',
      'pkg/sub',
      'pkg',
    ])
  })

  it('returns an empty array for a top-level node', () => {
    const nodes = [node('a.py', 'file')]
    expect(ancestorContainerIds('a.py', nodes, [])).toEqual([])
  })
})
