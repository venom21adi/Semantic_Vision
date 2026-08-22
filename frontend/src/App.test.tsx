import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from './api/client'
import type { GraphResponse } from './api/types'
import App from './App'

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return {
    ...actual,
    parseRepo: vi.fn(),
    getGraph: vi.fn(),
    getFunctionSource: vi.fn(),
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

async function loadSampleRepo() {
  const user = userEvent.setup()
  render(<App />)
  await user.type(screen.getByLabelText('Repository path'), '/repo')
  await user.click(screen.getByRole('button', { name: /load/i }))
  await waitFor(() => screen.getByText('greet'))
  return user
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('App', () => {
  it('loads a repository and renders its graph plus stats', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue(sampleGraph)

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
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue(sampleGraph)

    const user = await loadSampleRepo()
    await user.click(screen.getByText('greet'))

    expect(screen.getByRole('heading', { name: 'greet' })).toBeInTheDocument()
  })

  it('fetches and displays source via the context menu', async () => {
    mockedClient.parseRepo.mockResolvedValue({
      path: '/repo',
      node_count: 2,
      edge_count: 1,
      parse_errors: [],
    })
    mockedClient.getGraph.mockResolvedValue(sampleGraph)
    mockedClient.getFunctionSource.mockResolvedValue({
      id: 'app.py::Greeter.greet',
      file: 'app.py',
      line_start: 6,
      line_end: 8,
      source: 'def greet(self): ...',
    })

    const user = await loadSampleRepo()
    fireEvent.contextMenu(screen.getByText('greet'))
    await user.click(screen.getByRole('menuitem', { name: 'View Source' }))

    await waitFor(() => expect(screen.getByText('def greet(self): ...')).toBeInTheDocument())
    expect(mockedClient.getFunctionSource).toHaveBeenCalledWith('/repo', 'app.py::Greeter.greet')
  })
})
