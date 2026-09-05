import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from './api/client'
import type { GraphResponse, GraphStateResponse } from './api/types'

// `acquireVsCodeApi()` is resolved once at `App.tsx` module-load time --
// the global must be stubbed, and the module freshly (re)imported, before
// each test, exactly like `useLayoutWorker.test.ts` does for its own
// module-level `hasWorker` const. Every other App test file imports `App`
// statically and never stubs this global, so those runs exercise the
// "outside VS Code" (`vscodeApi === null`) branch, same as a real browser.
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

let postMessage: ReturnType<typeof vi.fn>

async function loadSampleRepoInsideVscode() {
  vi.resetAllMocks()
  localStorage.clear()
  postMessage = vi.fn()
  vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }))
  vi.resetModules()
  const { default: App } = await import('./App')

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

  const user = userEvent.setup()
  render(<App />)
  await user.type(screen.getByLabelText('Repository path'), '/repo')
  await user.click(screen.getByRole('button', { name: /load/i }))
  await waitFor(() => screen.getByTestId('rf__node-app.py::Greeter.greet'))
  return user
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

// `loadSampleRepoInsideVscode`'s `vi.resetModules()` + dynamic
// `import('./App')` (needed so `App.tsx`'s module-level `vscodeApi`
// re-resolves against the freshly-stubbed `acquireVsCodeApi` each test --
// see the comment above) is a genuinely more expensive cold import than a
// normal static one. Reliably fine on its own or as this file's only
// concern, but reproducibly exceeded Vitest's default 5000ms timeout when
// run inside the full ~260-test suite under real thread contention from
// every other test file transforming/running at the same time. A longer
// per-test timeout, not a smaller one, is the honest fix -- this isn't
// slow because of a bug in the code under test.
const TEST_TIMEOUT_MS = 20000

describe('App inside the VS Code extension webview', () => {
  it('posts an openSource message instead of fetching an inline snippet for View Source', async () => {
    await loadSampleRepoInsideVscode()

    // `fireEvent`, not `userEvent`, for this click: `userEvent`'s
    // real-timer-based pointer simulation combined with this file's
    // `vi.resetModules()` + dynamic `import('./App')` setup (needed so
    // the module-level `vscodeApi` re-resolves against the stubbed
    // `acquireVsCodeApi`) reproducibly timed out under the full test
    // suite's thread contention, even though the identical interaction
    // works fine in isolation and in the non-VS Code `App.test.tsx`
    // (which never resets modules). `fireEvent.click` dispatches
    // synchronously with no real-timer dependency and exercises the same
    // `onClick` handler.
    fireEvent.contextMenu(screen.getByTestId('rf__node-app.py::Greeter.greet'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View Source' }))

    expect(postMessage).toHaveBeenCalledWith({
      command: 'openSource',
      file: 'app.py',
      line: 6,
    })
    expect(mockedClient.getFunctionSource).not.toHaveBeenCalled()
  }, TEST_TIMEOUT_MS)

  it('switches to File view and selects the matching file node on an activeFileChanged message', async () => {
    await loadSampleRepoInsideVscode()

    window.postMessage({ command: 'activeFileChanged', file: 'app.py' }, '*')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'app.py' })).toBeInTheDocument())
    expect(screen.queryByText(/select a file, class, or function/i)).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('ignores an activeFileChanged message for a file not in the loaded graph', async () => {
    await loadSampleRepoInsideVscode()

    window.postMessage({ command: 'activeFileChanged', file: 'nonexistent.py' }, '*')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('heading', { name: 'nonexistent.py' })).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('runs Impact Analysis for the given node id on a runImpactAnalysis message', async () => {
    await loadSampleRepoInsideVscode()
    mockedClient.getImpact.mockResolvedValue({
      target: 'app.py::Greeter.greet',
      callers: [{ id: 'app.py', depth: 1, direct: true }],
      edges: [
        {
          source: 'app.py',
          target: 'app.py::Greeter.greet',
          kind: 'calls',
          external: false,
          ambiguous: false,
        },
      ],
      cycles: [],
    })

    window.postMessage({ command: 'runImpactAnalysis', nodeId: 'app.py::Greeter.greet' }, '*')

    await waitFor(() => expect(screen.getByText(/Direct callers/)).toBeInTheDocument())
    expect(mockedClient.getImpact).toHaveBeenCalledWith('/repo', 'app.py::Greeter.greet')
  }, TEST_TIMEOUT_MS)
})
