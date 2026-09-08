import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from './api/client'
import type { ComplexityResponse, GraphResponse, GraphStateResponse } from './api/types'
import App, { VISIBLE_IDS_SETTLE_MS } from './App'
import {
  getDetailsCollapsed,
  getLastRepoPath,
  getSidebarCollapsed,
  setDetailsCollapsed,
  setSidebarCollapsed,
} from './utils/localStorage'
import { AUTO_SAVE_POSITIONS_INTERVAL_MS, LARGE_GRAPH_NODE_THRESHOLD } from './graph/GraphCanvas'

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return {
    ...actual,
    parseRepo: vi.fn(),
    updateDocRoot: vi.fn(),
    getGraph: vi.fn(),
    getFunctionSource: vi.fn(),
    getGraphState: vi.fn(),
    saveGraphState: vi.fn(),
    getDoc: vi.fn(),
    saveDoc: vi.fn(),
    streamDoc: vi.fn(),
    getOllamaModels: vi.fn(),
    getImpact: vi.fn(),
    getFlowchart: vi.fn(),
    getComplexity: vi.fn(),
    getComplexityDiff: vi.fn(),
    getGitRefs: vi.fn(),
    getComplexityDiffRef: vi.fn(),
    getComplexityHotspots: vi.fn(),
    ingestDbtManifest: vi.fn(),
    ingestDbConnection: vi.fn(),
  }
})

const mockedClient = vi.mocked(client)

const sampleGraph: GraphResponse = {
  nodes: [
    { id: 'app.py', kind: 'file', label: 'app.py', file: 'app.py', line_start: 1, line_end: 8 },
    {
      id: 'app.py::Greeter.greet',
      kind: 'function',
      label: 'greet',
      file: 'app.py',
      line_start: 6,
      line_end: 8,
    },
  ],
  edges: [
    {
      source: 'app.py',
      target: 'app.py::Greeter.greet',
      kind: 'defines',
      external: false,
      ambiguous: false,
    },
  ],
}

const emptyGraphState: GraphStateResponse = { positions: {}, updated_at: null }

async function loadSampleRepo() {
  const user = userEvent.setup()
  render(<App />)
  await user.type(screen.getByLabelText('Repository path'), '/repo')
  await user.click(screen.getByRole('button', { name: /load/i }))
  await waitFor(() => screen.getByTestId('rf__node-app.py::Greeter.greet'))
  return user
}

/** Once a repo is loaded, the load form moves into the header's repo pill
 * popover (see `RepoPill`) instead of staying visible -- tests that need
 * to read or change the path/language/save-location fields after loading
 * have to open it first. */
async function openRepoPill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Current repository:/ }))
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mockedClient.getGraphState.mockResolvedValue(emptyGraphState)
  mockedClient.saveGraphState.mockResolvedValue(emptyGraphState)
  mockedClient.parseRepo.mockResolvedValue({
    path: '/repo',
    doc_root: '/repo',
    node_count: 2,
    edge_count: 1,
    parse_errors: [],
  })
  mockedClient.getGraph.mockResolvedValue(sampleGraph)
  mockedClient.getOllamaModels.mockResolvedValue({ models: [] })
  mockedClient.getGitRefs.mockResolvedValue({ is_git_repo: false, branches: [], commits: [] })
})

describe('App', () => {
  it('loads a repository and renders its graph plus stats', async () => {
    await loadSampleRepo()

    expect(
      screen.getByRole('button', { name: /^Current repository:/ }),
    ).toHaveTextContent('2 nodes, 1 edges')
  })

  it('loads a repository with the selected language and remembers it per repo path', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.selectOptions(screen.getByLabelText('Language'), 'javascript')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() => screen.getByTestId('rf__node-app.py::Greeter.greet'))

    expect(mockedClient.parseRepo).toHaveBeenCalledWith('/repo', undefined, 'javascript')

    unmount()
    render(<App />)

    expect(screen.getByLabelText('Language')).toHaveValue('javascript')
  })

  it('shows a load error from the API', async () => {
    mockedClient.parseRepo.mockRejectedValue(new client.ApiError(400, 'Not a directory'))
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Repository path'), '/nope')
    await user.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not a directory'))
  })

  it('syncs graph node selection to the details panel', async () => {
    const user = await loadSampleRepo()

    await user.click(screen.getByTestId('rf__node-app.py::Greeter.greet'))

    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
  })

  it('fetches and displays source via the context menu', async () => {
    mockedClient.getFunctionSource.mockResolvedValue({
      id: 'app.py::Greeter.greet',
      file: 'app.py',
      line_start: 6,
      line_end: 8,
      source: 'def greet(self): ...',
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'View Source' }))

    // Syntax highlighting fragments the line across several `<span>`s, so a
    // plain `getByText` for the whole line wouldn't match any single node
    // -- assert on the code block's overall text content instead.
    await waitFor(() =>
      expect(document.querySelector('code')).toHaveTextContent('def greet(self): ...'),
    )
    expect(mockedClient.getFunctionSource).toHaveBeenCalledWith('/repo', 'app.py::Greeter.greet')
  })

  it('fetches saved documentation via the context menu, or reports none saved', async () => {
    mockedClient.getDoc.mockRejectedValueOnce(new client.ApiError(404, 'No saved documentation for: x'))

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))

    await waitFor(() => expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument())

    mockedClient.getDoc.mockResolvedValueOnce({
      node_id: 'app.py::Greeter.greet',
      markdown: '# greet',
      updated_at: '2026-01-01T00:00:00+00:00',
    })
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument(),
    )
  })

  it('generates documentation by streaming, then saves it', async () => {
    mockedClient.getDoc.mockRejectedValueOnce(new client.ApiError(404, 'No saved documentation'))
    mockedClient.streamDoc.mockReturnValueOnce(
      (async function* () {
        yield '# greet\n\n'
        yield 'Returns a greeting.'
      })(),
    )
    mockedClient.saveDoc.mockResolvedValue({
      node_id: 'app.py::Greeter.greet',
      markdown: '# greet\n\nReturns a greeting.',
      updated_at: '2026-01-01T00:00:00+00:00',
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))
    await waitFor(() => expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument(),
    )
    expect(mockedClient.streamDoc).toHaveBeenCalledWith(
      '/repo',
      'app.py::Greeter.greet',
      'ollama',
      undefined,
      expect.anything(),
    )

    const saveButton = screen.getByRole('button', { name: 'Save' })
    await user.click(saveButton)

    await waitFor(() => expect(mockedClient.saveDoc).toHaveBeenCalledWith(
      '/repo',
      'app.py::Greeter.greet',
      '# greet\n\nReturns a greeting.',
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument())
  })

  it('lists local Ollama models and generates with the one the user picks', async () => {
    mockedClient.getOllamaModels.mockResolvedValue({
      models: ['llama3.2:3b', 'qwen2.5-coder:3b'],
    })
    mockedClient.getDoc.mockRejectedValueOnce(new client.ApiError(404, 'No saved documentation'))
    mockedClient.streamDoc.mockReturnValueOnce(
      (async function* () {
        yield 'docs'
      })(),
    )

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))
    await waitFor(() => expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument())

    const modelSelect = await screen.findByLabelText('Ollama model')
    await waitFor(() => expect(within(modelSelect).getAllByRole('option')).toHaveLength(2))

    await user.selectOptions(modelSelect, 'qwen2.5-coder:3b')
    await user.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() =>
      expect(mockedClient.streamDoc).toHaveBeenCalledWith(
        '/repo',
        'app.py::Greeter.greet',
        'ollama',
        'qwen2.5-coder:3b',
        expect.anything(),
      ),
    )
  })

  it('ignores stream chunks that arrive after generation is cancelled by switching nodes', async () => {
    mockedClient.getDoc.mockRejectedValueOnce(new client.ApiError(404, 'No saved documentation'))

    let releaseSecondChunk!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve
    })
    mockedClient.streamDoc.mockReturnValueOnce(
      (async function* () {
        yield '# greet\n\n'
        await gate
        yield 'stale content that must never render'
      })(),
    )

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))
    await waitFor(() => expect(screen.getByText(/no saved documentation yet/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument(),
    )

    const signal = mockedClient.streamDoc.mock.calls[0][4]
    expect(signal?.aborted).toBe(false)

    // Selecting a different node cancels the in-flight generation
    // (App.tsx's `handleSelectNode` -> `cancelGeneration`).
    await user.click(screen.getByTestId('rf__node-app.py'))
    expect(signal?.aborted).toBe(true)

    releaseSecondChunk()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText(/stale content/)).not.toBeInTheDocument()
  })

  it('fetches and displays impact analysis via the context menu, and jumps to a clicked caller', async () => {
    mockedClient.getImpact.mockResolvedValue({
      target: 'app.py::Greeter.greet',
      callers: [{ id: 'app.py', depth: 1, direct: true }],
      edges: [
        { source: 'app.py', target: 'app.py::Greeter.greet', kind: 'calls', external: false, ambiguous: false },
      ],
      cycles: [],
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Impact Analysis' }))

    await waitFor(() => expect(screen.getByText(/Direct callers/)).toBeInTheDocument())
    expect(mockedClient.getImpact).toHaveBeenCalledWith('/repo', 'app.py::Greeter.greet')

    await user.click(screen.getByRole('button', { name: 'View caller app.py' }))

    expect(screen.getByRole('heading', { name: 'app.py' })).toBeInTheDocument()
  })

  it('clears the Impact Analysis pane (and its graph highlight) when clicking empty canvas space', async () => {
    mockedClient.getImpact.mockResolvedValue({
      target: 'app.py::Greeter.greet',
      callers: [{ id: 'app.py', depth: 1, direct: true }],
      edges: [],
      cycles: [],
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Impact Analysis' }))
    await waitFor(() => expect(screen.getByText(/Direct callers/)).toBeInTheDocument())

    // Regression: previously there was no way to dismiss the Impact
    // Analysis pane/highlight once opened. Clicking empty canvas space
    // (which already deselects the node) should also clear it.
    const pane = document.querySelector('.react-flow__pane')
    expect(pane).not.toBeNull()
    fireEvent.click(pane as Element)

    expect(screen.queryByText(/Direct callers/)).not.toBeInTheDocument()
    // Exact text, not a substring regex: React Flow renders its own
    // hidden a11y description ("Press enter or space to select a node...")
    // which would otherwise also match a loose /select a node/i pattern.
    expect(screen.getByText('Select a node to see details.')).toBeInTheDocument()
  })

  it('closes the active pane via its own close button, without deselecting the node', async () => {
    mockedClient.getImpact.mockResolvedValue({
      target: 'app.py::Greeter.greet',
      callers: [{ id: 'app.py', depth: 1, direct: true }],
      edges: [],
      cycles: [],
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Impact Analysis' }))
    await waitFor(() => expect(screen.getByText(/Direct callers/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Close Impact Analysis panel' }))

    expect(screen.queryByText(/Direct callers/)).not.toBeInTheDocument()
    // The node itself stays selected -- only the pane closed.
    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
  })

  it('remembers the loaded path in localStorage and pre-fills it next time', async () => {
    expect(getLastRepoPath()).toBeNull()

    await loadSampleRepo()

    expect(getLastRepoPath()).toBe('/repo')

    // The loaded instance's own path field now lives behind its (closed)
    // repo pill popover, so only the fresh second instance's empty-state
    // form renders one.
    render(<App />)
    expect(screen.getByLabelText('Repository path')).toHaveValue('/repo')
  })

  it('persists sidebar and details-panel collapsed state to localStorage, independently', async () => {
    expect(getSidebarCollapsed()).toBe(false)
    expect(getDetailsCollapsed()).toBe(false)

    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(getSidebarCollapsed()).toBe(true)
    expect(getDetailsCollapsed()).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Collapse details panel' }))
    expect(getDetailsCollapsed()).toBe(true)
  })

  it('starts collapsed on mount when localStorage already remembers a collapsed state', async () => {
    setSidebarCollapsed(true)
    setDetailsCollapsed(true)

    await loadSampleRepo()

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand details panel' })).toBeInTheDocument()
  })

  it('shows the resolved save location after loading, and remembers it for next time', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/auto/detected/git-root',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })

    const user = await loadSampleRepo()
    await openRepoPill(user)

    expect(screen.getByLabelText('Save location')).toHaveValue('/auto/detected/git-root')

    render(<App />)
    // The just-opened popover's field (first instance) and the fresh
    // second instance's empty-state field both match now.
    expect(screen.getAllByLabelText('Save location')[1]).toHaveValue('/auto/detected/git-root')
  })

  it('shows a save-location notice on a loaded doc, and lets the user dismiss it for good', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/the/save/root',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getDoc.mockResolvedValueOnce({
      node_id: 'app.py::Greeter.greet',
      markdown: '# greet',
      updated_at: '2026-01-01T00:00:00+00:00',
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))

    await waitFor(() => expect(screen.getByText(/the\/save\/root/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /don't show again/i }))

    expect(screen.queryByText(/the\/save\/root/)).not.toBeInTheDocument()

    // Reload the same doc pane -- the dismissal should stick.
    mockedClient.getDoc.mockResolvedValueOnce({
      node_id: 'app.py::Greeter.greet',
      markdown: '# greet',
      updated_at: '2026-01-01T00:00:00+00:00',
    })
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'greet', level: 1 })).toBeInTheDocument(),
    )
    expect(screen.queryByText(/the\/save\/root/)).not.toBeInTheDocument()
  })

  it('changes the save location from the top field without re-parsing the repo', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/original/root',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getDoc.mockResolvedValueOnce({
      node_id: 'app.py::Greeter.greet',
      markdown: '# greet',
      updated_at: '2026-01-01T00:00:00+00:00',
    })
    mockedClient.updateDocRoot.mockResolvedValue({ doc_root: '/new/root' })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Document' }))
    await waitFor(() => expect(screen.getByText(/original\/root/)).toBeInTheDocument())

    await openRepoPill(user)
    const saveLocationInput = screen.getByLabelText('Save location')
    await user.clear(saveLocationInput)
    await user.type(saveLocationInput, '/new/root')
    await user.tab()

    await waitFor(() => expect(mockedClient.updateDocRoot).toHaveBeenCalledWith('/repo', '/new/root'))
    expect(mockedClient.parseRepo).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText(/new\/root/)).toBeInTheDocument())
  })

  it('fetches saved graph-state positions when loading a repository', async () => {
    await loadSampleRepo()

    expect(mockedClient.getGraphState).toHaveBeenCalledWith('/repo')
  })

  it('auto-saves node positions to the backend on the save interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      await user.type(screen.getByLabelText('Repository path'), '/repo')
      await user.click(screen.getByRole('button', { name: /load/i }))
      await vi.waitFor(() => screen.getByTestId('rf__node-app.py::Greeter.greet'))

      await vi.advanceTimersByTimeAsync(AUTO_SAVE_POSITIONS_INTERVAL_MS)

      // Exact match, not a subset check: every rendered node's position
      // must be included, not just the one this test happens to name.
      expect(mockedClient.saveGraphState).toHaveBeenCalledWith('/repo', {
        'app.py': { x: expect.any(Number), y: expect.any(Number) },
        'app.py::Greeter.greet': { x: expect.any(Number), y: expect.any(Number) },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the sidebar tree and syncs selecting a tree item to the details panel', async () => {
    await loadSampleRepo()

    const tree = screen.getByRole('tree')
    await userEvent.setup().click(within(tree).getByText('greet'))

    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
  })

  it('re-expands a container collapsed via Collapse All when its hidden child is selected from the sidebar tree', async () => {
    const user = await loadSampleRepo()

    // Force-collapse everything -- `greet` (inside `app.py`) is no longer
    // rendered on the canvas, only its containing file is.
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    // Both assertions in one `waitFor`, not sequential -- `visibleIds`
    // changes settle on a debounce (Milestone 18), so a mid-settle poll can
    // transiently satisfy "greet gone" while the canvas itself is still
    // between layouts and `app.py` isn't rendered yet either.
    await waitFor(() => {
      expect(screen.queryByTestId('rf__node-app.py::Greeter.greet')).not.toBeInTheDocument()
      expect(screen.getByTestId('rf__node-app.py')).toBeInTheDocument()
    })

    // Selecting it from the sidebar tree (which isn't collapse-aware) must
    // force-expand `app.py` so the selected node actually becomes visible
    // on the canvas again, instead of leaving `selectedNodeId` pointing at
    // something collapseGraph never renders.
    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByText('greet'))

    await waitFor(() =>
      expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument(),
    )
  })

  it('starts the canvas empty with a placeholder for a large repo, until a directory/file is selected', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: LARGE_GRAPH_NODE_THRESHOLD + 1,
      edge_count: 1,
      parse_errors: [],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('rf__node-app.py')).not.toBeInTheDocument()

    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByLabelText('Show app.py on canvas'))

    await waitFor(() => expect(screen.getByTestId('rf__node-app.py')).toBeInTheDocument())
  })

  it('Reset selection returns a large repo to the empty-state placeholder', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: LARGE_GRAPH_NODE_THRESHOLD + 1,
      edge_count: 1,
      parse_errors: [],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )

    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByLabelText('Show app.py on canvas'))
    await waitFor(() => expect(screen.getByTestId('rf__node-app.py')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Reset selection' }))

    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )
  })

  it('selecting a node from the sidebar tree on a large repo adds its root to the canvas, not just expanding it', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: LARGE_GRAPH_NODE_THRESHOLD + 1,
      edge_count: 1,
      parse_errors: [],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )

    // Clicking the row label (not its checkbox) selects the node -- nothing
    // was ever checked, so without the fix `app.py` would stay outside
    // `selectedRootIds` and never render, even though it'd be "expanded."
    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByText('greet'))

    await waitFor(() =>
      expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument(),
    )
  })

  it('unchecking a file whose parent directory is already visible removes just that file from the canvas', async () => {
    // The core fix for the sidebar/canvas desync: previously, once a
    // directory was selected (pulling in its whole subtree), unchecking
    // one of its children had *no effect at all* -- the old two-set model
    // could only add a subtree, never toggle one specific descendant
    // within it regardless of the ancestor's own state.
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: 3,
      edge_count: 2,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue({
      nodes: [
        { id: 'pkg', kind: 'directory', label: 'pkg', file: 'pkg', line_start: 0, line_end: 0 },
        { id: 'pkg/a.py', kind: 'file', label: 'a.py', file: 'pkg/a.py', line_start: 1, line_end: 1 },
        { id: 'pkg/b.py', kind: 'file', label: 'b.py', file: 'pkg/b.py', line_start: 1, line_end: 1 },
      ],
      edges: [
        { source: 'pkg', target: 'pkg/a.py', kind: 'defines', external: false, ambiguous: false },
        { source: 'pkg', target: 'pkg/b.py', kind: 'defines', external: false, ambiguous: false },
      ],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() => expect(screen.getByTestId('rf__node-pkg/a.py')).toBeInTheDocument())
    expect(screen.getByTestId('rf__node-pkg/b.py')).toBeInTheDocument()

    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByLabelText('Show a.py on canvas'))

    // All three in one `waitFor` -- `visibleIds` changes settle on a
    // debounce (Milestone 18), so a mid-settle poll can transiently satisfy
    // "a.py gone" while the canvas is still between layouts and `b.py`/
    // `pkg` (untouched by unchecking their sibling) aren't rendered yet
    // either.
    await waitFor(() => {
      expect(screen.queryByTestId('rf__node-pkg/a.py')).not.toBeInTheDocument()
      expect(screen.getByTestId('rf__node-pkg/b.py')).toBeInTheDocument()
      expect(screen.getByTestId('rf__node-pkg')).toBeInTheDocument()
    })
  })

  it('coalesces a rapid burst of checkbox clicks into one canvas update instead of one per click', async () => {
    // The actual point of `VISIBLE_IDS_SETTLE_MS` (Milestone 18,
    // docs/PHASE-2-BUILD-PLAN.md): a rapid burst of `visibleIds` changes
    // must not each force their own separate `buildVisibleGraph`/layout
    // pass. Verified here by never letting fake time advance past the
    // debounce window mid-burst -- if debouncing weren't actually
    // coalescing, `pkg/a.py` would already be gone from the DOM the
    // instant it's unchecked, before this test ever advances the clock.
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: 3,
      edge_count: 2,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue({
      nodes: [
        { id: 'pkg', kind: 'directory', label: 'pkg', file: 'pkg', line_start: 0, line_end: 0 },
        { id: 'pkg/a.py', kind: 'file', label: 'a.py', file: 'pkg/a.py', line_start: 1, line_end: 1 },
        { id: 'pkg/b.py', kind: 'file', label: 'b.py', file: 'pkg/b.py', line_start: 1, line_end: 1 },
      ],
      edges: [
        { source: 'pkg', target: 'pkg/a.py', kind: 'defines', external: false, ambiguous: false },
        { source: 'pkg', target: 'pkg/b.py', kind: 'defines', external: false, ambiguous: false },
      ],
    })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ delay: null })
      render(<App />)
      await user.type(screen.getByLabelText('Repository path'), '/repo')
      await user.click(screen.getByRole('button', { name: /load/i }))
      await vi.waitFor(() => screen.getByTestId('rf__node-pkg/a.py'))

      const tree = screen.getByRole('tree')
      const aCheckbox = within(tree).getByLabelText('Show a.py on canvas')

      // A burst of three toggles on the same checkbox, no time advanced
      // between them -- exactly the rapid-fire pattern the debounce exists
      // to coalesce.
      await user.click(aCheckbox) // off
      await user.click(aCheckbox) // on
      await user.click(aCheckbox) // off

      // Still mid-debounce: the canvas must not have reacted to any of the
      // three toggles yet, including the two that already reversed
      // themselves.
      expect(screen.getByTestId('rf__node-pkg/a.py')).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(VISIBLE_IDS_SETTLE_MS)

      // Settles once, directly to the burst's *final* state (off) -- not
      // an intermediate one, and not three separate updates.
      await vi.waitFor(() =>
        expect(screen.queryByTestId('rf__node-pkg/a.py')).not.toBeInTheDocument(),
      )
      expect(screen.getByTestId('rf__node-pkg/b.py')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expanding a container via its canvas chevron keeps the container itself visible, not just its children', async () => {
    // Previously the container was *replaced* by its children on expand
    // (removed from `visibleIds`): its sidebar checkbox went back to
    // unchecked even though its contents were now on screen, and the
    // newly-revealed children had no visible parent box connecting
    // them -- they looked like disconnected orphans.
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: LARGE_GRAPH_NODE_THRESHOLD + 1,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue({
      nodes: [
        { id: 'pkg', kind: 'directory', label: 'pkg', file: 'pkg', line_start: 0, line_end: 0 },
        { id: 'pkg/a.py', kind: 'file', label: 'a.py', file: 'pkg/a.py', line_start: 1, line_end: 1 },
        { id: 'pkg/b.py', kind: 'file', label: 'b.py', file: 'pkg/b.py', line_start: 1, line_end: 1 },
      ],
      edges: [
        { source: 'pkg', target: 'pkg/a.py', kind: 'defines', external: false, ambiguous: false },
        { source: 'pkg', target: 'pkg/b.py', kind: 'defines', external: false, ambiguous: false },
      ],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )

    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByLabelText('Show pkg on canvas'))
    await waitFor(() => expect(screen.getByTestId('rf__node-pkg')).toBeInTheDocument())

    await user.click(screen.getByTestId('rf__node-pkg').querySelector('[data-node-toggle]')!)

    await waitFor(() => expect(screen.getByTestId('rf__node-pkg/a.py')).toBeInTheDocument())
    expect(screen.getByTestId('rf__node-pkg/b.py')).toBeInTheDocument()
    // The container itself is still there, and its checkbox still checked.
    expect(screen.getByTestId('rf__node-pkg')).toBeInTheDocument()
    expect(within(tree).getByLabelText('Show pkg on canvas')).toBeChecked()
  })

  it('unchecking a directory in the sidebar hides its already-revealed children too', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: LARGE_GRAPH_NODE_THRESHOLD + 1,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue({
      nodes: [
        { id: 'pkg', kind: 'directory', label: 'pkg', file: 'pkg', line_start: 0, line_end: 0 },
        { id: 'pkg/a.py', kind: 'file', label: 'a.py', file: 'pkg/a.py', line_start: 1, line_end: 1 },
        { id: 'pkg/b.py', kind: 'file', label: 'b.py', file: 'pkg/b.py', line_start: 1, line_end: 1 },
      ],
      edges: [
        { source: 'pkg', target: 'pkg/a.py', kind: 'defines', external: false, ambiguous: false },
        { source: 'pkg', target: 'pkg/b.py', kind: 'defines', external: false, ambiguous: false },
      ],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )

    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByLabelText('Show pkg on canvas'))
    await waitFor(() => expect(screen.getByTestId('rf__node-pkg')).toBeInTheDocument())
    await user.click(screen.getByTestId('rf__node-pkg').querySelector('[data-node-toggle]')!)
    await waitFor(() => expect(screen.getByTestId('rf__node-pkg/a.py')).toBeInTheDocument())

    await user.click(within(tree).getByLabelText('Show pkg on canvas'))

    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('rf__node-pkg/a.py')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rf__node-pkg/b.py')).not.toBeInTheDocument()
  })

  it('blocks expanding a container with too many children on the canvas and points the user at the sidebar', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      doc_root: '/repo',
      node_count: LARGE_GRAPH_NODE_THRESHOLD + 1,
      edge_count: 1,
      parse_errors: [],
    })
    const manyFiles = Array.from({ length: 13 }, (_, i) => ({
      id: `pkg/file${i}.py`,
      kind: 'file' as const,
      label: `file${i}.py`,
      file: `pkg/file${i}.py`,
      line_start: 1,
      line_end: 1,
    }))
    mockedClient.getGraph.mockResolvedValue({
      nodes: [
        { id: 'pkg', kind: 'directory', label: 'pkg', file: 'pkg', line_start: 0, line_end: 0 },
        ...manyFiles,
      ],
      edges: manyFiles.map((file) => ({
        source: 'pkg',
        target: file.id,
        kind: 'defines' as const,
        external: false,
        ambiguous: false,
      })),
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Repository path'), '/repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Select a directory or file in the sidebar to add it to the canvas.'),
      ).toBeInTheDocument(),
    )

    const tree = screen.getByRole('tree')
    await user.click(within(tree).getByLabelText('Show pkg on canvas'))
    await waitFor(() => expect(screen.getByTestId('rf__node-pkg')).toBeInTheDocument())

    await user.click(screen.getByTestId('rf__node-pkg').querySelector('[data-node-toggle]')!)

    await waitFor(() => expect(screen.getByText(/has 13 items/)).toBeInTheDocument())
    expect(screen.getByText(/Use the sidebar checkboxes/)).toBeInTheDocument()
    // Nothing was actually expanded -- still just the one collapsed box.
    expect(screen.getAllByTestId(/^rf__node-/)).toHaveLength(1)
  })

  it('fetches and renders the execution flowchart via the context menu, then returns to the graph', async () => {
    mockedClient.getFlowchart.mockResolvedValue({
      target: 'app.py::Greeter.greet',
      entry: 'app.py::Greeter.greet::n0',
      nodes: [
        {
          id: 'app.py::Greeter.greet::n0',
          kind: 'entry',
          label: 'def greet(self):',
          line: 6,
          end_line: 6,
        },
        {
          id: 'app.py::Greeter.greet::n1',
          kind: 'return',
          label: 'return path',
          line: 7,
          end_line: 7,
        },
      ],
      edges: [
        {
          source: 'app.py::Greeter.greet::n0',
          target: 'app.py::Greeter.greet::n1',
          kind: 'flow',
          label: null,
        },
      ],
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Execution Flowchart' }))

    await waitFor(() => expect(screen.getByText('Execution flowchart: greet')).toBeInTheDocument())
    expect(mockedClient.getFlowchart).toHaveBeenCalledWith('/repo', 'app.py::Greeter.greet')
    expect(screen.getByText('def greet(self):')).toBeInTheDocument()
    expect(screen.getByText('return path')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))

    expect(screen.queryByText('Execution flowchart: greet')).not.toBeInTheDocument()
    expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument()
  })

  it('shows an error and a way back to the graph when fetching the flowchart fails', async () => {
    mockedClient.getFlowchart.mockRejectedValue(new client.ApiError(404, 'Function not found'))

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    await user.click(screen.getByRole('menuitem', { name: 'Execution Flowchart' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Function not found'))

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))

    expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument()
  })

  it('shows a placeholder in File view until a file-scoped node is selected', async () => {
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Current file' }))
    expect(screen.getByText(/select a file, class, or function/i)).toBeInTheDocument()

    await user.click(within(screen.getByRole('tree')).getByText('greet'))
    expect(screen.queryByText(/select a file, class, or function/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument()
  })

  it('fetches and shows the performance report when Show complexity is toggled on', async () => {
    mockedClient.getComplexity.mockResolvedValue({
      scores: [
        {
          node_id: 'app.py::Greeter.greet',
          cyclomatic_complexity: 4,
          call_chain_depth: 0,
          has_nested_loops: false,
        },
      ],
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Show complexity' }))

    expect(mockedClient.getComplexity).toHaveBeenCalledWith('/repo')
    await waitFor(() => expect(screen.getByText('Performance Report')).toBeInTheDocument())
    expect(screen.getByText(/app\.py::Greeter\.greet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide complexity' })).toBeInTheDocument()
  })

  it('closes the performance report and reverts the toggle when clicked again', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Show complexity' }))
    await waitFor(() => expect(screen.getByText('Performance Report')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Hide complexity' }))

    expect(screen.queryByText('Performance Report')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show complexity' })).toBeInTheDocument()
  })

  it('does not resurrect the performance report if it is closed before the fetch resolves', async () => {
    let resolveComplexity: (value: ComplexityResponse) => void = () => {}
    mockedClient.getComplexity.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveComplexity = resolve
        }),
    )
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Show complexity' }))
    await waitFor(() => expect(screen.getByText('Performance Report')).toBeInTheDocument())

    // Close it before the (still in-flight) fetch has a chance to resolve.
    await user.click(screen.getByRole('button', { name: 'Hide complexity' }))
    expect(screen.queryByText('Performance Report')).not.toBeInTheDocument()

    resolveComplexity({ scores: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('Performance Report')).not.toBeInTheDocument()
  })

  it('does not attach a stale repo\'s complexity scores after switching repos mid-fetch', async () => {
    let resolveComplexity: (value: ComplexityResponse) => void = () => {}
    mockedClient.getComplexity.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveComplexity = resolve
        }),
    )
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Show complexity' }))
    await waitFor(() => expect(screen.getByText('Performance Report')).toBeInTheDocument())

    // Load a different repo while the first repo's complexity fetch is
    // still in flight -- App.tsx's `handleLoad` resets `pane` to null.
    mockedClient.parseRepo.mockResolvedValueOnce({
      path: '/other-repo',
      doc_root: '/other-repo',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    await openRepoPill(user)
    await user.clear(screen.getByLabelText('Repository path'))
    await user.type(screen.getByLabelText('Repository path'), '/other-repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() => expect(screen.queryByText('Performance Report')).not.toBeInTheDocument())

    resolveComplexity({ scores: [{ node_id: 'stale', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false }] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('Performance Report')).not.toBeInTheDocument()
  })

  it('fetches and shows the dashboard when Open dashboard is toggled on', async () => {
    mockedClient.getComplexity.mockResolvedValue({
      scores: [
        {
          node_id: 'app.py::Greeter.greet',
          cyclomatic_complexity: 4,
          call_chain_depth: 0,
          has_nested_loops: false,
        },
      ],
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))

    expect(mockedClient.getComplexity).toHaveBeenCalledWith('/repo')
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    expect(screen.getByText(/app\.py::Greeter\.greet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close dashboard' })).toBeInTheDocument()
  })

  it('closes the dashboard and reverts the toggle when clicked again', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Close dashboard' }))

    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open dashboard' })).toBeInTheDocument()
  })

  it('does not resurrect the dashboard if it is closed before the fetch resolves', async () => {
    let resolveComplexity: (value: ComplexityResponse) => void = () => {}
    mockedClient.getComplexity.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveComplexity = resolve
        }),
    )
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    // Close it before the (still in-flight) fetch has a chance to resolve.
    await user.click(screen.getByRole('button', { name: 'Close dashboard' }))
    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()

    resolveComplexity({ scores: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()
  })

  it("does not attach a stale repo's dashboard scores after switching repos mid-fetch", async () => {
    let resolveComplexity: (value: ComplexityResponse) => void = () => {}
    mockedClient.getComplexity.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveComplexity = resolve
        }),
    )
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    // Load a different repo while the first repo's dashboard fetch is
    // still in flight -- App.tsx's `handleLoad` resets `dashboard` to null.
    mockedClient.parseRepo.mockResolvedValueOnce({
      path: '/other-repo',
      doc_root: '/other-repo',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    await openRepoPill(user)
    await user.clear(screen.getByLabelText('Repository path'))
    await user.type(screen.getByLabelText('Repository path'), '/other-repo')
    await user.click(screen.getByRole('button', { name: /load/i }))
    await waitFor(() => expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument())

    resolveComplexity({ scores: [{ node_id: 'stale', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false }] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()
  })

  it('does not apply a stale fetch when the dashboard is closed and reopened before it resolves', async () => {
    let resolveFirst: (value: ComplexityResponse) => void = () => {}
    let resolveSecond: (value: ComplexityResponse) => void = () => {}
    mockedClient.getComplexity
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Close dashboard' }))
    await waitFor(() => expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    // The first (stale) fetch resolves after the second (current) one has
    // already started -- its scores must never make it onto the screen.
    resolveFirst({
      scores: [{ node_id: 'stale', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument()

    resolveSecond({
      scores: [{ node_id: 'fresh', cyclomatic_complexity: 2, call_chain_depth: 0, has_nested_loops: false }],
    })
    await waitFor(() => expect(screen.getByText(/fresh/)).toBeInTheDocument())
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument()
  })

  it('closes the dashboard when a node is selected from the sidebar tree', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    await user.click(within(screen.getByRole('tree')).getByText('greet'))

    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open dashboard' })).toBeInTheDocument()
  })

  it('runs a compare and shows the diff results plus the refreshed ranked list', async () => {
    mockedClient.getComplexity.mockResolvedValue({
      scores: [
        {
          node_id: 'app.py::Greeter.greet',
          cyclomatic_complexity: 4,
          call_chain_depth: 0,
          has_nested_loops: false,
        },
      ],
    })
    mockedClient.getComplexityDiff.mockResolvedValue({
      available: true,
      current: [
        {
          node_id: 'app.py::Greeter.greet',
          cyclomatic_complexity: 9,
          call_chain_depth: 0,
          has_nested_loops: false,
        },
      ],
      added: [],
      removed: [],
      changed: [
        {
          node_id: 'app.py::Greeter.greet',
          before: {
            node_id: 'app.py::Greeter.greet',
            cyclomatic_complexity: 4,
            call_chain_depth: 0,
            has_nested_loops: false,
          },
          after: {
            node_id: 'app.py::Greeter.greet',
            cyclomatic_complexity: 9,
            call_chain_depth: 0,
            has_nested_loops: false,
          },
        },
      ],
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))

    expect(mockedClient.parseRepo).toHaveBeenLastCalledWith('/repo', '/repo', 'python')
    await waitFor(() => expect(mockedClient.getComplexityDiff).toHaveBeenCalledWith('/repo'))
    await waitFor(() => expect(screen.getByText(/Changed/)).toBeInTheDocument())
    // The ranked list itself refreshes from `diffResult.current`, not a
    // separate `getComplexity` re-fetch.
    expect(screen.getByText(/complexity 4 → 9/)).toBeInTheDocument()
  })

  it('prunes a removed function out of visibleIds so it stops inflating "on canvas"', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    const user = await loadSampleRepo()
    // Both sample nodes start visible (small repo, under the auto-select
    // threshold) -- confirms the starting count before the prune.
    expect(screen.getByText('2 on canvas')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    // The compare's own reparse reports the function gone entirely.
    mockedClient.getGraph.mockResolvedValueOnce({
      nodes: [{ id: 'app.py', kind: 'file', label: 'app.py', file: 'app.py', line_start: 1, line_end: 8 }],
      edges: [],
    })
    mockedClient.getComplexityDiff.mockResolvedValue({
      available: true,
      current: [],
      added: [],
      removed: [
        {
          node_id: 'app.py::Greeter.greet',
          cyclomatic_complexity: 4,
          call_chain_depth: 0,
          has_nested_loops: false,
        },
      ],
      changed: [],
    })

    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))
    await waitFor(() => expect(screen.getByText(/Removed/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    expect(screen.getByText('1 on canvas')).toBeInTheDocument()
  })

  it('does not resurrect the dashboard if it is closed while a compare is in flight', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    mockedClient.getComplexityDiff.mockResolvedValue({
      available: true,
      current: [],
      added: [],
      removed: [],
      changed: [],
    })
    let resolveParse: (value: Awaited<ReturnType<typeof client.parseRepo>>) => void = () => {}
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    mockedClient.parseRepo.mockImplementationOnce(
      () => new Promise((resolve) => (resolveParse = resolve)),
    )
    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))

    // Close the dashboard before the compare's own reparse resolves.
    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()

    resolveParse({ path: '/repo', doc_root: '/repo', node_count: 2, edge_count: 1, parse_errors: [] })
    // The fixed behavior bails out right after `getGraph` resolves (the
    // stale-request guard fires before `getComplexityDiff` is ever called),
    // so there's nothing to `waitFor` on -- just flush enough ticks to get
    // past that one remaining await.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('Code Health Dashboard')).not.toBeInTheDocument()
    expect(mockedClient.getComplexityDiff).not.toHaveBeenCalled()
  })

  // The "Compare to last look" button disables itself while a compare is
  // already in flight (see `DashboardView`'s `compareDisabled`), so two
  // overlapping compares can't actually be triggered by clicking it twice --
  // that disabled state is itself a stronger guarantee than a request-id
  // guard alone would be. The reachable variant of this race is a stale
  // compare resolving *after* the dashboard has been closed and reopened
  // (starting a fresh compare) in between -- exercised here.
  it('ignores a stale compare response that resolves after closing and reopening the dashboard', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    let resolveFirstDiff: (value: Awaited<ReturnType<typeof client.getComplexityDiff>>) => void =
      () => {}
    mockedClient.getComplexityDiff
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstDiff = resolve)))
      .mockResolvedValueOnce({ available: true, current: [], added: [], removed: [], changed: [] })

    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))
    await waitFor(() => expect(mockedClient.getComplexityDiff).toHaveBeenCalledTimes(1))

    // Close, then reopen a fresh dashboard session while the first compare
    // is still in flight, and run a second compare in it.
    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))
    await waitFor(() => expect(mockedClient.getComplexityDiff).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('No changes vs last look.')).toBeInTheDocument())

    // The first (stale) compare's diff resolves only now -- it must not
    // overwrite the second, current session's result.
    resolveFirstDiff({
      available: true,
      current: [
        { node_id: 'stale', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false },
      ],
      added: [],
      removed: [],
      changed: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('No changes vs last look.')).toBeInTheDocument()
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument()
  })

  it('runs a compare-to-ref and shows the diff results labeled with the ref', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    mockedClient.getGitRefs.mockResolvedValue({
      is_git_repo: true,
      branches: ['main'],
      commits: [{ sha: 'abc1234', subject: 'earlier commit' }],
    })
    mockedClient.getComplexityDiffRef.mockResolvedValue({
      ref: 'abc1234',
      to_ref: null,
      available: true,
      current: [],
      added: [],
      removed: [],
      changed: [],
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Git ref to compare against'), 'abc1234')
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    await waitFor(() =>
      expect(mockedClient.getComplexityDiffRef).toHaveBeenCalledWith('/repo', 'abc1234', undefined),
    )
    // Never reparses -- diff-ref compares state already reflected in
    // `repo`/`dashboard` against the ref, unlike "Compare to last look".
    // The one call already happened during `loadSampleRepo()`'s initial load.
    expect(mockedClient.parseRepo).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByText('No changes vs abc1234 earlier commit.')).toBeInTheDocument(),
    )
  })

  it('runs a ref-vs-ref compare when the optional "to" field is filled in', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    mockedClient.getGitRefs.mockResolvedValue({
      is_git_repo: true,
      branches: ['main', 'feature'],
      commits: [],
    })
    mockedClient.getComplexityDiffRef.mockResolvedValue({
      ref: 'main',
      to_ref: 'feature',
      available: true,
      current: [],
      added: [],
      removed: [],
      changed: [],
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.type(
      screen.getByLabelText('Second git ref to compare against (optional, defaults to the current state)'),
      'feature',
    )
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    await waitFor(() =>
      expect(mockedClient.getComplexityDiffRef).toHaveBeenCalledWith('/repo', 'main', 'feature'),
    )
    // Ref-vs-ref never touches current on-disk state either -- no reparse.
    expect(mockedClient.parseRepo).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('No changes main → feature.')).toBeInTheDocument())
  })

  // Mirrors the existing "ignores a stale compare response..." test above,
  // for the ref-diff variant: the ref-picker's own Compare button disables
  // itself while a compare is in flight (`compareDisabled` in
  // `DashboardView`), so two overlapping ref compares can't actually be
  // triggered by clicking it twice -- the reachable variant is a stale
  // response resolving after the dashboard was closed and reopened.
  it('ignores a stale ref-diff response that resolves after closing and reopening the dashboard', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    mockedClient.getGitRefs.mockResolvedValue({ is_git_repo: true, branches: ['main'], commits: [] })
    let resolveFirstRefDiff: (value: Awaited<ReturnType<typeof client.getComplexityDiffRef>>) => void =
      () => {}
    mockedClient.getComplexityDiffRef
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstRefDiff = resolve)))
      .mockResolvedValueOnce({
        ref: 'main',
        to_ref: null,
        available: true,
        current: [],
        added: [],
        removed: [],
        changed: [],
      })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    await waitFor(() => expect(mockedClient.getComplexityDiffRef).toHaveBeenCalledTimes(1))

    // Close, then reopen a fresh dashboard session while the first ref
    // compare is still in flight, and run a second ref compare in it.
    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    await waitFor(() => expect(mockedClient.getComplexityDiffRef).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('No changes vs main.')).toBeInTheDocument())

    // The first (stale) ref compare's diff resolves only now -- it must
    // not overwrite the second, current session's result. Distinguished
    // via a non-empty `added` bucket (not just a different `current`,
    // which `handleCompareDashboardToRef` never feeds into anything
    // rendered) so an unguarded overwrite is actually observable.
    resolveFirstRefDiff({
      ref: 'main',
      to_ref: null,
      available: true,
      current: [],
      added: [
        { node_id: 'stale', cyclomatic_complexity: 1, call_chain_depth: 0, has_nested_loops: false },
      ],
      removed: [],
      changed: [],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('No changes vs main.')).toBeInTheDocument()
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument()
  })

  it('ignores a stale git-refs response that resolves after closing and reopening the dashboard', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    let resolveFirstRefs: (value: Awaited<ReturnType<typeof client.getGitRefs>>) => void = () => {}
    mockedClient.getGitRefs
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstRefs = resolve)))
      .mockResolvedValueOnce({ is_git_repo: true, branches: ['second-session-branch'], commits: [] })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    // Close, then reopen a fresh dashboard session while the first
    // session's git-refs fetch is still in flight.
    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await waitFor(() =>
      expect(
        Array.from(document.body.querySelectorAll('option')).map((o) => o.value),
      ).toEqual(['second-session-branch']),
    )

    // The first (stale) session's refs resolve only now -- must not
    // overwrite the second, current session's ref-picker data.
    resolveFirstRefs({ is_git_repo: true, branches: ['first-session-branch'], commits: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(Array.from(document.body.querySelectorAll('option')).map((o) => o.value)).toEqual([
      'second-session-branch',
    ])
  })

  it('lazily loads hotspots only when the Hotspots tab is first opened', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    mockedClient.getComplexityHotspots.mockResolvedValue({
      is_git_repo: true,
      scores: [{ node_id: 'app.py::hot', cyclomatic_complexity: 3, change_count: 4, hotspot_score: 12 }],
      window_days: 90,
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())

    expect(mockedClient.getComplexityHotspots).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledWith('/repo', 90))
    await waitFor(() => expect(screen.getByText(/app\.py::hot/)).toBeInTheDocument())
  })

  it('loads hotspots even when clicked before the complexity fetch has resolved', async () => {
    // The Hotspots tab is never disabled while `dashboard` is still
    // loading (unlike the Compare button, which is) -- `handleLoadHotspots`
    // must not silently no-op just because the unrelated complexity fetch
    // hasn't settled yet, or the tab gets stuck on "Loading…" until a
    // second, later click happens to land after it does.
    let resolveComplexity: (value: ComplexityResponse) => void = () => {}
    mockedClient.getComplexity.mockImplementationOnce(
      () => new Promise((resolve) => (resolveComplexity = resolve)),
    )
    mockedClient.getComplexityHotspots.mockResolvedValue({
      is_git_repo: true,
      scores: [{ node_id: 'app.py::hot', cyclomatic_complexity: 3, change_count: 4, hotspot_score: 12 }],
      window_days: 90,
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    // At this point `dashboard` is still `{ status: 'loading' }` -- the
    // complexity fetch hasn't resolved yet.
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledWith('/repo', 90))
    await waitFor(() => expect(screen.getByText(/app\.py::hot/)).toBeInTheDocument())

    resolveComplexity({ scores: [] })
  })

  it('clears hotspots when the dashboard is closed', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    mockedClient.getComplexityHotspots.mockResolvedValue({
      is_git_repo: true,
      scores: [{ node_id: 'app.py::hot', cyclomatic_complexity: 3, change_count: 4, hotspot_score: 12 }],
      window_days: 90,
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await waitFor(() => expect(screen.getByText(/app\.py::hot/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    // A fresh session must fetch again -- the previous session's result was
    // cleared, not carried over silently.
    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledTimes(2))
  })

  it('ignores a stale hotspots response that resolves after closing and reopening the dashboard', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    let resolveFirstHotspots: (value: Awaited<ReturnType<typeof client.getComplexityHotspots>>) => void =
      () => {}
    mockedClient.getComplexityHotspots
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstHotspots = resolve)))
      .mockResolvedValueOnce({
        is_git_repo: true,
        scores: [{ node_id: 'second', cyclomatic_complexity: 1, change_count: 1, hotspot_score: 1 }],
        window_days: 90,
      })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledTimes(1))

    // Close, then reopen a fresh dashboard session while the first
    // session's hotspots fetch is still in flight.
    await user.click(screen.getByRole('button', { name: 'Back to graph' }))
    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText(/second/)).toBeInTheDocument())

    // The first (stale) session's hotspots resolve only now -- must not
    // overwrite the second, current session's result.
    resolveFirstHotspots({
      is_git_repo: true,
      scores: [{ node_id: 'stale', cyclomatic_complexity: 1, change_count: 1, hotspot_score: 1 }],
      window_days: 90,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText(/second/)).toBeInTheDocument()
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument()
  })

  it('ignores a stale hotspots response for an earlier window when a newer window was selected first', async () => {
    mockedClient.getComplexity.mockResolvedValue({ scores: [] })
    let resolveNinetyDayFetch: (value: Awaited<ReturnType<typeof client.getComplexityHotspots>>) => void =
      () => {}
    mockedClient.getComplexityHotspots
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNinetyDayFetch = resolve)))
      .mockResolvedValueOnce({
        is_git_repo: true,
        scores: [{ node_id: 'thirty-day', cyclomatic_complexity: 1, change_count: 1, hotspot_score: 1 }],
        window_days: 30,
      })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Open dashboard' }))
    await waitFor(() => expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument())
    // Opens the tab (fires the 90-day fetch, left pending) then immediately
    // switches the window selector to 30 days (fires a second fetch) before
    // the first one resolves.
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledTimes(1))
    await user.selectOptions(screen.getByLabelText('Window'), '30')
    await waitFor(() => expect(mockedClient.getComplexityHotspots).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText(/thirty-day/)).toBeInTheDocument())

    // The stale 90-day fetch resolves only now -- must not clobber the
    // newer, current 30-day result the user is actually looking at.
    resolveNinetyDayFetch({
      is_git_repo: true,
      scores: [{ node_id: 'ninety-day', cyclomatic_complexity: 1, change_count: 1, hotspot_score: 1 }],
      window_days: 90,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText(/thirty-day/)).toBeInTheDocument()
    expect(screen.queryByText(/ninety-day/)).not.toBeInTheDocument()
  })

  it('opens and closes the Add tables & models panel via the sidebar toggle', async () => {
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Add tables & models' }))
    expect(screen.getByRole('heading', { name: 'Add tables & models' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add tables & models' }))
    expect(screen.queryByRole('heading', { name: 'Add tables & models' })).not.toBeInTheDocument()
  })

  it('re-fetches the graph after a successful dbt manifest ingest, showing the new node', async () => {
    mockedClient.ingestDbtManifest.mockResolvedValue({
      models_ingested: 1,
      tables_reconciled: 0,
      tables_created: 1,
      columns_reconciled: 0,
      columns_created: 0,
    })
    mockedClient.getGraph.mockResolvedValueOnce(sampleGraph).mockResolvedValueOnce({
      nodes: [
        ...sampleGraph.nodes,
        { id: 'table::orders', kind: 'table', label: 'orders', file: 'manifest.json', line_start: 1, line_end: 1, source: 'dbt' },
      ],
      edges: sampleGraph.edges,
    })
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Add tables & models' }))
    await user.type(screen.getByLabelText(/dbt manifest.json path/i), '/repo/target/manifest.json')
    await user.click(screen.getByRole('button', { name: /^ingest$/i }))

    await waitFor(() => expect(screen.getByText(/1 model ingested/i)).toBeInTheDocument())
    expect(mockedClient.getGraph).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByTestId('rf__node-table::orders')).toBeInTheDocument())
  })

  it('does not refresh the graph when the dbt manifest ingest fails', async () => {
    mockedClient.ingestDbtManifest.mockRejectedValue(new Error('Not valid JSON'))
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'Add tables & models' }))
    await user.type(screen.getByLabelText(/dbt manifest.json path/i), '/bad.json')
    await user.click(screen.getByRole('button', { name: /^ingest$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not valid JSON'))
    expect(mockedClient.getGraph).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect a table node the user explicitly deselected after a reconciling re-ingest', async () => {
    const graphWithTable: GraphResponse = {
      nodes: [
        ...sampleGraph.nodes,
        {
          id: 'table::users',
          kind: 'table',
          label: 'users',
          file: 'models.py',
          line_start: 1,
          line_end: 1,
          source: 'orm_model',
        },
      ],
      edges: sampleGraph.edges,
    }
    mockedClient.getGraph.mockResolvedValue(graphWithTable)
    mockedClient.ingestDbtManifest.mockResolvedValue({
      models_ingested: 1,
      tables_reconciled: 1,
      tables_created: 0,
      columns_reconciled: 0,
      columns_created: 0,
    })
    const user = await loadSampleRepo()

    // `table::users` is root-level (no `defines` parent) and the repo is
    // well under the large-graph threshold, so it starts selected/shown.
    await waitFor(() => expect(screen.getByTestId('rf__node-table::users')).toBeInTheDocument())

    // The user explicitly hides it via its sidebar checkbox. `visibleIds`
    // changes settle on a debounce (Milestone 18), so the canvas update
    // isn't synchronous with the click -- wait for it.
    await user.click(screen.getByLabelText('Show users on canvas'))
    await waitFor(() =>
      expect(screen.queryByTestId('rf__node-table::users')).not.toBeInTheDocument(),
    )

    // A dbt ingest reconciles onto the SAME table (no new root) -- the
    // graph refetch keeps returning the identical node set.
    await user.click(screen.getByRole('button', { name: 'Add tables & models' }))
    await user.type(screen.getByLabelText(/dbt manifest.json path/i), '/repo/target/manifest.json')
    await user.click(screen.getByRole('button', { name: /^ingest$/i }))
    await waitFor(() => expect(screen.getByText(/1 model ingested/i)).toBeInTheDocument())

    // Reconciling onto an already-known node is not "newly ingested" --
    // the user's deselection must survive, not be silently overridden.
    await waitFor(() =>
      expect(screen.queryByTestId('rf__node-table::users')).not.toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Show users on canvas')).not.toBeChecked()
  })
})
