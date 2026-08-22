import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from './api/client'
import type { GraphResponse, GraphStateResponse } from './api/types'
import App from './App'
import { getLastRepoPath } from './utils/localStorage'
import { AUTO_SAVE_POSITIONS_INTERVAL_MS } from './graph/GraphCanvas'

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return {
    ...actual,
    parseRepo: vi.fn(),
    getGraph: vi.fn(),
    getFunctionSource: vi.fn(),
    getGraphState: vi.fn(),
    saveGraphState: vi.fn(),
    getDoc: vi.fn(),
    getImpact: vi.fn(),
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
    node_count: 2,
    edge_count: 1,
    parse_errors: [],
  })
  mockedClient.getGraph.mockResolvedValue(sampleGraph)
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

    await waitFor(() => expect(screen.getByText('# greet')).toBeInTheDocument())
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

  it('remembers the loaded path in localStorage and pre-fills it next time', async () => {
    expect(getLastRepoPath()).toBeNull()

    await loadSampleRepo()

    expect(getLastRepoPath()).toBe('/repo')

    render(<App />)
    expect(screen.getAllByLabelText('Repository path')[1]).toHaveValue('/repo')
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

  it('shows a placeholder in File view until a file-scoped node is selected', async () => {
    const user = await loadSampleRepo()

    await user.click(screen.getByRole('button', { name: 'file' }))
    expect(screen.getByText(/select a file, class, or function/i)).toBeInTheDocument()

    await user.click(within(screen.getByRole('tree')).getByText('greet'))
    expect(screen.queryByText(/select a file, class, or function/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('rf__node-app.py::Greeter.greet')).toBeInTheDocument()
  })
})
