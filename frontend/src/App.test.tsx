import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from './api/client'
import type { GraphResponse, GraphStateResponse } from './api/types'
import App from './App'
import {
  getDetailsCollapsed,
  getLastRepoPath,
  getSidebarCollapsed,
  setDetailsCollapsed,
  setSidebarCollapsed,
} from './utils/localStorage'
import { AUTO_SAVE_POSITIONS_INTERVAL_MS } from './graph/GraphCanvas'

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
})

describe('App', () => {
  it('loads a repository and renders its graph plus stats', async () => {
    await loadSampleRepo()

    expect(screen.getByTestId('repo-status')).toHaveTextContent('/repo — 2 nodes, 1 edges')
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

    await waitFor(() => expect(screen.getByText('def greet(self): ...')).toBeInTheDocument())
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

    await waitFor(() => expect(screen.getByText('Direct callers')).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Direct callers')).toBeInTheDocument())

    // Regression: previously there was no way to dismiss the Impact
    // Analysis pane/highlight once opened. Clicking empty canvas space
    // (which already deselects the node) should also clear it.
    const pane = document.querySelector('.react-flow__pane')
    expect(pane).not.toBeNull()
    fireEvent.click(pane as Element)

    expect(screen.queryByText('Direct callers')).not.toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText('Direct callers')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Close Impact Analysis panel' }))

    expect(screen.queryByText('Direct callers')).not.toBeInTheDocument()
    // The node itself stays selected -- only the pane closed.
    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
  })

  it('remembers the loaded path in localStorage and pre-fills it next time', async () => {
    expect(getLastRepoPath()).toBeNull()

    await loadSampleRepo()

    expect(getLastRepoPath()).toBe('/repo')

    render(<App />)
    expect(screen.getAllByLabelText('Repository path')[1]).toHaveValue('/repo')
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

    await loadSampleRepo()

    expect(screen.getByLabelText('Save location')).toHaveValue('/auto/detected/git-root')

    render(<App />)
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

    await user.click(screen.getByRole('button', { name: 'file' }))
    expect(screen.getByText(/select a file, class, or function/i)).toBeInTheDocument()

    await user.click(within(screen.getByRole('tree')).getByText('greet'))
    expect(screen.queryByText(/select a file, class, or function/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument()
  })
})
