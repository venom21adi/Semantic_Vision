import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import { RepoLoader } from './RepoLoader'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, detectLanguages: vi.fn() }
})

const mockedClient = vi.mocked(client)

beforeEach(() => {
  mockedClient.detectLanguages.mockResolvedValue({
    detected: ['python'],
    supported: ['python', 'javascript', 'java'],
    default_doc_root: '/detected/default/root',
  })
})

/** Advances to the languages step. When `path` is given, types it in first
 * (clearing whatever's already there); when omitted, uses whatever value
 * the field already has (e.g. from `initialPath`) without retyping it. */
async function goToLanguageStep(user: ReturnType<typeof userEvent.setup>, path?: string) {
  if (path !== undefined) {
    const input = screen.getByLabelText('Repository path')
    await user.clear(input)
    await user.type(input, path)
  }
  await user.click(screen.getByRole('button', { name: /next: pick languages/i }))
  await screen.findByText(/which languages should be loaded/i)
}

async function goToSaveLocationStep(user: ReturnType<typeof userEvent.setup>, path?: string) {
  await goToLanguageStep(user, path)
  await user.click(screen.getByRole('button', { name: /next: save location/i }))
  await screen.findByLabelText('Save location')
}

describe('RepoLoader', () => {
  it('scans the path, moves to the languages step, and pre-checks what it detected', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    await goToLanguageStep(user, '/some/repo')

    expect(screen.getByRole('checkbox', { name: 'Load Python' })).toBeChecked()
  })

  it('disables the scan button until a path is typed', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    expect(screen.getByRole('button', { name: /next: pick languages/i })).toBeDisabled()
  })

  it('shows a detected-but-unsupported language as a disabled checkbox', async () => {
    mockedClient.detectLanguages.mockResolvedValue({
      detected: ['python', 'go'],
      supported: ['python', 'javascript', 'java'],
      default_doc_root: '/detected/default/root',
    })
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    await goToLanguageStep(user, '/some/repo')

    expect(screen.getByText(/go \(detected, not supported yet\)/i)).toBeInTheDocument()
  })

  it('proceeds to the save-location step pre-filled with the detected default', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    await goToSaveLocationStep(user, '/some/repo')

    expect(screen.getByLabelText('Save location')).toHaveValue('/detected/default/root')
  })

  it('calls onLoad with the path, detected default doc root, and checked language', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} stats={null} />)

    await goToSaveLocationStep(user, '  /some/repo  ')
    await user.click(screen.getByRole('button', { name: /^load$/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo', '/detected/default/root', ['python'])
  })

  it('calls onLoad with a manually edited save location', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} stats={null} />)

    await goToSaveLocationStep(user, '/some/repo')
    const input = screen.getByLabelText('Save location')
    await user.clear(input)
    await user.type(input, '  /my/save/spot  ')
    await user.click(screen.getByRole('button', { name: /^load$/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo', '/my/save/spot', ['python'])
  })

  it('calls onLoad with every checked language', async () => {
    mockedClient.detectLanguages.mockResolvedValue({
      detected: ['python', 'javascript'],
      supported: ['python', 'javascript', 'java'],
      default_doc_root: '/detected/default/root',
    })
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} stats={null} />)

    await goToSaveLocationStep(user, '/some/repo')
    await user.click(screen.getByRole('button', { name: /^load$/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo', '/detected/default/root', [
      'python',
      'javascript',
    ])
  })

  it('toggles a language off via its checkbox', async () => {
    mockedClient.detectLanguages.mockResolvedValue({
      detected: ['python', 'javascript'],
      supported: ['python', 'javascript', 'java'],
      default_doc_root: '/detected/default/root',
    })
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} stats={null} />)

    await goToLanguageStep(user, '/some/repo')
    await user.click(screen.getByRole('checkbox', { name: 'Load JavaScript / TypeScript' }))
    await user.click(screen.getByRole('button', { name: /next: save location/i }))
    await user.click(screen.getByRole('button', { name: /^load$/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo', '/detected/default/root', ['python'])
  })

  it('disables Next until at least one language is checked', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    await goToLanguageStep(user, '/some/repo')
    await user.click(screen.getByRole('checkbox', { name: 'Load Python' }))

    expect(screen.getByRole('button', { name: /next: save location/i })).toBeDisabled()
  })

  it('going Back from languages to path preserves the typed path', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    await goToLanguageStep(user, '/some/repo')
    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByLabelText('Repository path')).toHaveValue('/some/repo')
  })

  it('going Back from save-location to languages preserves the checked languages', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    await goToSaveLocationStep(user, '/some/repo')
    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByRole('checkbox', { name: 'Load Python' })).toBeChecked()
  })

  it('pre-fills languages from initialLanguages instead of the freshly detected ones', async () => {
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        initialLanguages={['javascript']}
      />,
    )

    await goToLanguageStep(user, '/some/repo')

    expect(screen.getByRole('checkbox', { name: 'Load JavaScript / TypeScript' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Load Python' })).not.toBeChecked()
  })

  it('pre-fills the path from initialPath', () => {
    render(
      <RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} initialPath="/last/repo" />,
    )

    expect(screen.getByLabelText('Repository path')).toHaveValue('/last/repo')
  })

  it('pre-fills the save-location step from initialDocRoot rather than the detected default', async () => {
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        initialDocRoot="/remembered/save"
      />,
    )

    await goToSaveLocationStep(user, '/some/repo')

    expect(screen.getByLabelText('Save location')).toHaveValue('/remembered/save')
  })

  it('applies a save-location-only change live instead of reloading, once a repo is loaded', async () => {
    const onLoad = vi.fn()
    const onChangeDocRoot = vi.fn()
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={onLoad}
        loading={false}
        error={null}
        stats={null}
        initialPath="/some/repo"
        initialLanguages={['python']}
        resolvedDocRoot="/repo/.visualiser"
        hasLoadedRepo
        onChangeDocRoot={onChangeDocRoot}
      />,
    )

    await goToSaveLocationStep(user, '/some/repo')
    const input = screen.getByLabelText('Save location')
    await user.clear(input)
    await user.type(input, '/new/save/spot')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))

    expect(onChangeDocRoot).toHaveBeenCalledWith('/new/save/spot')
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('reloads instead of a live doc-root change when the path changed too', async () => {
    const onLoad = vi.fn()
    const onChangeDocRoot = vi.fn()
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={onLoad}
        loading={false}
        error={null}
        stats={null}
        initialPath="/some/repo"
        initialLanguages={['python']}
        resolvedDocRoot="/repo/.visualiser"
        hasLoadedRepo
        onChangeDocRoot={onChangeDocRoot}
      />,
    )

    const pathInput = screen.getByLabelText('Repository path')
    await user.clear(pathInput)
    await user.type(pathInput, '/a/different/repo')
    await user.click(screen.getByRole('button', { name: /next: pick languages/i }))
    await screen.findByText(/which languages should be loaded/i)
    await user.click(screen.getByRole('button', { name: /next: save location/i }))
    await user.click(screen.getByRole('button', { name: /^apply$/i }))

    expect(onLoad).toHaveBeenCalledWith('/a/different/repo', '/repo/.visualiser', ['python'])
    expect(onChangeDocRoot).not.toHaveBeenCalled()
  })

  it('shows an error message on the save-location step', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={false} error="Directory not found" stats={null} />)

    await goToSaveLocationStep(user, '/some/repo')

    expect(screen.getByRole('alert')).toHaveTextContent('Directory not found')
  })

  it('disables the final button and shows a spinner while loading', async () => {
    const user = userEvent.setup()
    render(<RepoLoader onLoad={vi.fn()} loading={true} error={null} stats={null} />)

    await goToSaveLocationStep(user, '/some/repo')

    const button = screen.getByRole('button', { name: /loading/i })
    expect(button).toBeDisabled()
    expect(button.querySelector('.spinner')).toBeInTheDocument()
  })

  it('shows success stats without a details toggle when there are no parse errors', () => {
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={{ path: '/repo', nodeCount: 5, edgeCount: 7, parseErrors: [] }}
      />,
    )

    expect(screen.getByText(/\/repo — 5 nodes, 7 edges/)).toBeInTheDocument()
    expect(screen.queryByText(/parse error/)).not.toBeInTheDocument()
  })

  it('shows parse errors behind a collapsible summary', async () => {
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={{
          path: '/repo',
          nodeCount: 3,
          edgeCount: 1,
          parseErrors: [{ file: 'bad.py', line: 2, message: 'invalid syntax' }],
        }}
      />,
    )

    const details = screen.getByText('1 parse error').closest('details')
    expect(details).not.toHaveAttribute('open')

    await user.click(screen.getByText('1 parse error'))

    expect(details).toHaveAttribute('open')
    expect(screen.getByText(/bad\.py:2 — invalid syntax/)).toBeInTheDocument()
  })
})
