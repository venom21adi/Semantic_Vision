import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepoLoader } from './RepoLoader'

describe('RepoLoader', () => {
  it('calls onLoad with the trimmed path on submit', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<RepoLoader onLoad={onLoad} loading={false} error={null} />)

    await user.type(screen.getByLabelText('Repository path'), '  /some/repo  ')
    await user.click(screen.getByRole('button', { name: /load/i }))

    expect(onLoad).toHaveBeenCalledWith('/some/repo')
  })

  it('disables the button for a blank path', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={false} error={null} />)

    expect(screen.getByRole('button', { name: /load/i })).toBeDisabled()
  })

  it('disables the button and shows a loading label while loading', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={true} error={null} />)

    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled()
  })

  it('shows an error message when provided', () => {
    render(<RepoLoader onLoad={vi.fn()} loading={false} error="Directory not found" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Directory not found')
  })
})
