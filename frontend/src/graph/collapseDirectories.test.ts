import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../api/types'
import { buildVisibleGraph, collapseToOutermost, directChildIds, subtreeIds } from './collapseDirectories'

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

describe('buildVisibleGraph', () => {
  it('renders nothing when visibleIds is empty', () => {
    const nodes = [node('pkg', 'directory'), node('pkg/a.py', 'file', 'a.py')]
    const edges = [defines('pkg', 'pkg/a.py')]

    const result = buildVisibleGraph(nodes, edges, new Set())

    expect(result).toEqual({ nodes: [], edges: [], containerState: new Map() })
  })

  it('reproduces the input unchanged when every node is independently visible', () => {
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

    const result = buildVisibleGraph(nodes, edges, new Set(nodes.map((n) => n.id)))

    expect(result.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id))
    expect(result.edges).toEqual(edges)
  })

  it('collapses a visible directory down to itself, hiding its descendants', () => {
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

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg', 'other.py']))

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['other.py', 'pkg'])
    expect(result.containerState.get('pkg')).toEqual({ expanded: false, hiddenDescendantCount: 2 })
    // The internal `defines` edges (pkg->a.py, a.py->f) collapse into
    // self-loops on `pkg` and are dropped; only the call escaping the
    // collapsed directory survives, remapped to `pkg`.
    expect(result.edges).toEqual([calls('pkg', 'other.py')])
  })

  it('folds a nested non-visible subdirectory into the outermost visible ancestor', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/sub', 'directory', 'sub'),
      node('pkg/sub/a.py', 'file', 'a.py'),
    ]
    const edges = [defines('pkg', 'pkg/sub'), defines('pkg/sub', 'pkg/sub/a.py')]

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg']))

    // Not ['pkg', 'pkg/sub'] -- `sub` itself is hidden inside `pkg`, not a
    // second visible bubble.
    expect(result.nodes.map((n) => n.id)).toEqual(['pkg'])
    expect(result.containerState.get('pkg')?.hiddenDescendantCount).toBe(2)
  })

  it('a directory checked independently renders standalone even though its parent is not visible', () => {
    // The core fix this module exists for: checking/unchecking any id, at
    // any depth, must always affect the canvas regardless of what its
    // ancestors are doing -- unlike the old two-set model, where a
    // child's checkbox did nothing once a parent was already selected.
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/sub', 'directory', 'sub'),
      node('pkg/sub/a.py', 'file', 'a.py'),
    ]
    const edges = [defines('pkg', 'pkg/sub'), defines('pkg/sub', 'pkg/sub/a.py')]

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg/sub']))

    expect(result.nodes.map((n) => n.id)).toEqual(['pkg/sub'])
    expect(result.containerState.get('pkg/sub')).toEqual({ expanded: false, hiddenDescendantCount: 1 })
  })

  it('keeps a subdirectory as its own visible node when its parent is also visible but it is separately visible too', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/sub', 'directory', 'sub'),
      node('pkg/sub/a.py', 'file', 'a.py'),
    ]
    const edges = [defines('pkg', 'pkg/sub'), defines('pkg/sub', 'pkg/sub/a.py')]

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg', 'pkg/sub']))

    expect(result.nodes.map((n) => n.id)).toEqual(['pkg', 'pkg/sub'])
    expect(result.containerState.get('pkg')).toEqual({ expanded: true, hiddenDescendantCount: 0 })
    expect(result.containerState.get('pkg/sub')).toEqual({ expanded: false, hiddenDescendantCount: 1 })
  })

  it('unchecking a child that was pulled in via an expanded parent folds it back into the parent', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/b.py', 'file', 'b.py'),
    ]
    const edges = [defines('pkg', 'pkg/a.py'), defines('pkg', 'pkg/b.py')]

    // Both children were revealed (e.g. by expanding `pkg`); the user then
    // unchecks `pkg/a.py` specifically.
    const result = buildVisibleGraph(nodes, edges, new Set(['pkg', 'pkg/b.py']))

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['pkg', 'pkg/b.py'])
    expect(result.containerState.get('pkg')?.hiddenDescendantCount).toBe(1)
  })

  it('treats a file as its own collapse boundary, not just directories', () => {
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

    const result = buildVisibleGraph(nodes, edges, new Set(['api.py', 'other.py']))

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['api.py', 'other.py'])
    expect(result.containerState.get('api.py')).toEqual({ expanded: false, hiddenDescendantCount: 3 })
    expect(result.edges).toEqual([calls('api.py', 'other.py', { count: 2 })])
  })

  it('treats a table as its own collapse boundary over its column children', () => {
    // Milestone 17e: `table` joined `CONTAINER_KINDS` once a table can
    // have `column` children via `DEFINES` -- this locks in that the
    // generic containment/rollup logic (already proven above for
    // directory/file) works unmodified for this new container kind too.
    const nodes = [
      node('table::users', 'table', 'users'),
      node('column::users.id', 'column', 'id'),
      node('column::users.name', 'column', 'name'),
      node('app.py::get_user', 'function', 'get_user'),
    ]
    const edges = [
      defines('table::users', 'column::users.id'),
      defines('table::users', 'column::users.name'),
      { source: 'app.py::get_user', target: 'column::users.name', kind: 'writes', external: false, ambiguous: false } as GraphEdge,
    ]

    const result = buildVisibleGraph(nodes, edges, new Set(['table::users', 'app.py::get_user']))

    expect(result.nodes.map((n) => n.id).sort()).toEqual(['app.py::get_user', 'table::users'])
    expect(result.containerState.get('table::users')).toEqual({
      expanded: false,
      hiddenDescendantCount: 2,
    })
    // The `writes` edge into the collapsed `column::users.name` rolls up
    // to its table, same as a `calls` edge into a collapsed file's
    // function would roll up to that file -- no column-specific logic
    // needed, since this is the exact same remapping every other
    // container kind already gets.
    expect(result.edges).toEqual([
      { source: 'app.py::get_user', target: 'table::users', kind: 'writes', external: false, ambiguous: false },
    ])
  })

  it('expands a table to show its columns as independently visible nodes', () => {
    const nodes = [
      node('table::users', 'table', 'users'),
      node('column::users.id', 'column', 'id'),
      node('column::users.name', 'column', 'name'),
    ]
    const edges = [
      defines('table::users', 'column::users.id'),
      defines('table::users', 'column::users.name'),
    ]

    const result = buildVisibleGraph(
      nodes,
      edges,
      new Set(['table::users', 'column::users.id', 'column::users.name']),
    )

    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'column::users.id',
      'column::users.name',
      'table::users',
    ])
    expect(result.containerState.get('table::users')).toEqual({
      expanded: true,
      hiddenDescendantCount: 0,
    })
  })

  it('keeps a real edge between two independently visible subtrees', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
      node('other', 'directory'),
      node('other/b.py', 'file', 'b.py'),
      node('other/b.py::g', 'function', 'g'),
    ]
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('pkg/a.py', 'pkg/a.py::f'),
      defines('other', 'other/b.py'),
      defines('other/b.py', 'other/b.py::g'),
      calls('pkg/a.py::f', 'other/b.py::g'),
    ]

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg', 'other']))

    expect(result.edges).toContainEqual(calls('pkg', 'other'))
  })

  it('drops an edge reaching a node with no visible ancestor at all', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('unselected', 'directory'),
      node('unselected/c.py', 'file', 'c.py'),
    ]
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('unselected', 'unselected/c.py'),
      calls('pkg/a.py', 'unselected/c.py'),
    ]

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg']))

    expect(result.nodes.map((n) => n.id)).toEqual(['pkg'])
    expect(result.edges).toEqual([])
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
      calls('pkg/a.py::f', 'pkg/b.py::g'),
    ]

    const result = buildVisibleGraph(nodes, edges, new Set(['pkg']))

    expect(result.edges.some((e) => e.kind === 'calls')).toBe(false)
  })

  it('ignores a stale or nonexistent visible id without crashing', () => {
    const nodes = [node('pkg', 'directory')]
    const result = buildVisibleGraph(nodes, [], new Set(['does-not-exist']))
    expect(result).toEqual({ nodes: [], edges: [], containerState: new Map() })
  })

  it('reflects each call\'s own visibleIds correctly when called repeatedly with the same edges array (parent-structure cache)', () => {
    const nodes = [
      node('pkg', 'directory'),
      node('pkg/a.py', 'file', 'a.py'),
      node('pkg/a.py::f', 'function', 'f'),
    ]
    const edges = [defines('pkg', 'pkg/a.py'), defines('pkg/a.py', 'pkg/a.py::f')]

    // Repeated calls against the exact same `edges` array (as App.tsx's
    // stable `codebaseGraph.edges` does across checkbox clicks) must not
    // leak one call's `visibleIds` into another's result via the cached
    // parent structure -- only `parentOf`/`childCountByParent` are shared;
    // `representativeOf` is still computed fresh per call.
    const collapsedToRoot = buildVisibleGraph(nodes, edges, new Set(['pkg']))
    expect(collapsedToRoot.nodes.map((n) => n.id)).toEqual(['pkg'])

    const drilledIntoFile = buildVisibleGraph(nodes, edges, new Set(['pkg/a.py']))
    expect(drilledIntoFile.nodes.map((n) => n.id)).toEqual(['pkg/a.py'])

    const backToRoot = buildVisibleGraph(nodes, edges, new Set(['pkg']))
    expect(backToRoot.nodes.map((n) => n.id)).toEqual(['pkg'])
  })

  it('does not leak a cached parent structure across two distinct edges arrays with the same node ids', () => {
    const nodes = [node('pkg', 'directory'), node('pkg/a.py', 'file', 'a.py'), node('pkg/b.py', 'file', 'b.py')]
    // Same node ids, two different `defines` relationships (2 children vs.
    // 1), two distinct `edges` array identities -- if a caching bug reused
    // edgesA's parent structure for the edgesB call (e.g. one shared
    // variable instead of a per-array cache), `pkg`'s hiddenDescendantCount
    // below would wrongly stay 2 instead of dropping to 1.
    const edgesA = [defines('pkg', 'pkg/a.py'), defines('pkg', 'pkg/b.py')]
    const edgesB = [defines('pkg', 'pkg/a.py')]

    const resultA = buildVisibleGraph(nodes, edgesA, new Set(['pkg']))
    expect(resultA.containerState.get('pkg')?.hiddenDescendantCount).toBe(2)

    const resultB = buildVisibleGraph(nodes, edgesB, new Set(['pkg']))
    expect(resultB.containerState.get('pkg')?.hiddenDescendantCount).toBe(1)
  })
})

describe('directChildIds', () => {
  it('returns only the immediate defines-children of a node', () => {
    const edges = [
      defines('pkg', 'pkg/a.py'),
      defines('pkg', 'pkg/b.py'),
      defines('pkg/a.py', 'pkg/a.py::f'), // grandchild -- not direct
    ]
    expect(directChildIds('pkg', edges).sort()).toEqual(['pkg/a.py', 'pkg/b.py'])
  })

  it('returns an empty array for a node with no children', () => {
    expect(directChildIds('pkg/a.py::f', [defines('pkg', 'pkg/a.py')])).toEqual([])
  })
})

describe('subtreeIds', () => {
  it('returns every descendant at any depth, not just immediate children', () => {
    const edges = [
      defines('pkg', 'pkg/sub'),
      defines('pkg/sub', 'pkg/sub/a.py'),
      defines('pkg/sub/a.py', 'pkg/sub/a.py::f'),
      defines('pkg', 'pkg/other.py'),
    ]
    expect(subtreeIds('pkg', edges).size === 4).toBe(true)
    expect([...subtreeIds('pkg', edges)].sort()).toEqual([
      'pkg/other.py',
      'pkg/sub',
      'pkg/sub/a.py',
      'pkg/sub/a.py::f',
    ])
  })

  it('returns an empty set for a node with no children', () => {
    expect(subtreeIds('pkg/a.py::f', [defines('pkg', 'pkg/a.py')])).toEqual(new Set())
  })
})

describe('collapseToOutermost', () => {
  it('keeps independent top-level selections untouched', () => {
    const edges = [defines('pkg', 'pkg/a.py'), defines('other', 'other/b.py')]
    const result = collapseToOutermost(new Set(['pkg', 'other']), edges)
    expect(result).toEqual(new Set(['pkg', 'other']))
  })

  it('drops a drilled-into descendant, keeping only its outermost visible ancestor', () => {
    const edges = [
      defines('pkg', 'pkg/sub'),
      defines('pkg/sub', 'pkg/sub/a.py'),
      defines('pkg/sub/a.py', 'pkg/sub/a.py::f'),
    ]
    // Drilled two levels deep under `pkg`.
    const result = collapseToOutermost(new Set(['pkg', 'pkg/sub', 'pkg/sub/a.py::f']), edges)
    expect(result).toEqual(new Set(['pkg']))
  })

  it('does not fold a node with no visible ancestor even if unrelated ids are also visible', () => {
    const edges = [defines('pkg', 'pkg/a.py')]
    const result = collapseToOutermost(new Set(['pkg', 'unrelated']), edges)
    expect(result).toEqual(new Set(['pkg', 'unrelated']))
  })
})
