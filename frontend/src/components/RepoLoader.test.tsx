import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepoLoader } from './RepoLoader'

describe('RepoLoader', () => {
  it('calls onLoad with the trimmed path and an empty doc root by default', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} stats={null} />)

    await user.type(screen.getByLabelText('Repository path'), '  /some/repo  ')
    await user.click(screen.getByRole('button', { name: /load/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo', '')
  })

  it('calls onLoad with a manually typed save location', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} stats={null} />)

    await user.type(screen.getByLabelText('Repository path'), '/some/repo')
    await user.type(screen.getByLabelText('Save location'), '  /my/save/spot  ')
    await user.click(screen.getByRole('button', { name: /load/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo', '/my/save/spot')
  })

  it('pre-fills the save location from initialDocRoot', () => {
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        initialDocRoot="/remembered/save"
      />,
    )

    expect(screen.getByLabelText('Save location')).toHaveValue('/remembered/save')
  })

  it('updates the save location field when resolvedDocRoot changes', () => {
    const { rerender } = render(
      <RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />,
    )

    expect(screen.getByLabelText('Save location')).toHaveValue('')

    rerender(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        resolvedDocRoot="/auto/detected/root"
      />,
    )

    expect(screen.getByLabelText('Save location')).toHaveValue('/auto/detected/root')
  })

  it('commits a save-location change live on blur once a repo is loaded', async () => {
    const onChangeDocRoot = vi.fn()
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        resolvedDocRoot="/repo/.visualiser"
        hasLoadedRepo={true}
        onChangeDocRoot={onChangeDocRoot}
      />,
    )

    const input = screen.getByLabelText('Save location')
    await user.clear(input)
    await user.type(input, '/new/save/spot')
    await user.tab()

    expect(onChangeDocRoot).toHaveBeenCalledWith('/new/save/spot')
  })

  it('commits a save-location change on Enter without submitting the load form', async () => {
    const onChangeDocRoot = vi.fn()
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={onLoad}
        loading={false}
        error={null}
        stats={null}
        resolvedDocRoot="/repo/.visualiser"
        hasLoadedRepo={true}
        onChangeDocRoot={onChangeDocRoot}
      />,
    )

    const input = screen.getByLabelText('Save location')
    await user.clear(input)
    await user.type(input, '/new/save/spot{Enter}')

    expect(onChangeDocRoot).toHaveBeenCalledWith('/new/save/spot')
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('snaps a cleared save-location field back to the resolved value instead of leaving it blank', async () => {
    const onChangeDocRoot = vi.fn()
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        resolvedDocRoot="/repo/.visualiser"
        hasLoadedRepo={true}
        onChangeDocRoot={onChangeDocRoot}
      />,
    )

    const input = screen.getByLabelText('Save location')
    await user.clear(input)
    await user.tab()

    expect(onChangeDocRoot).not.toHaveBeenCalled()
    expect(input).toHaveValue('/repo/.visualiser')
  })

  it('does not commit a save-location change live before any repo is loaded', async () => {
    const onChangeDocRoot = vi.fn()
    const user = userEvent.setup()
    render(
      <RepoLoader
        onLoad={vi.fn()}
        loading={false}
        error={null}
        stats={null}
        onChangeDocRoot={onChangeDocRoot}
      />,
    )

    await user.type(screen.getByLabelText('Save location'), '/new/save/spot')
    await user.tab()

    expect(onChangeDocRoot).not.toHaveBeenCalled()
  })

  it('disables the button for a blank path', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} />)

    expect(screen.getByRole('button', { name: /load/i })).toBeDisabled()
  })

  it('disables the button and shows a spinner while loading', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={true} error={null} stats={null} />)

    const button = screen.getByRole('button', { name: /loading/i })
    expect(button).toBeDisabled()
    expect(button.querySelector('.spinner')).toBeInTheDocument()
  })

  it('shows an error message when provided', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={false} error="Directory not found" stats={null} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Directory not found')
  })

  it('pre-fills the path from initialPath', () => {
    render(
      <RepoLoader onLoad={vi.fn()} loading={false} error={null} stats={null} initialPath="/last/repo" />,
    )

    expect(screen.getByLabelText('Repository path')).toHaveValue('/last/repo')
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
