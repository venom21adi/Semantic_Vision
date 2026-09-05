import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecordingLightbox } from './RecordingLightbox'

describe('RecordingLightbox', () => {
  it('renders the image with the given src and alt', () => {
    render(<RecordingLightbox src="/demo/media/x.gif" alt="A recording" onClose={vi.fn()} />)

    const img = screen.getByRole('img', { name: 'A recording' })
    expect(img).toHaveAttribute('src', '/demo/media/x.gif')
  })

  it('closes when clicking the backdrop', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<RecordingLightbox src="/demo/media/x.gif" alt="A recording" onClose={onClose} />)

    await user.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when clicking the image itself', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<RecordingLightbox src="/demo/media/x.gif" alt="A recording" onClose={onClose} />)

    await user.click(screen.getByRole('img', { name: 'A recording' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when clicking the close button', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<RecordingLightbox src="/demo/media/x.gif" alt="A recording" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<RecordingLightbox src="/demo/media/x.gif" alt="A recording" onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('focuses the close button on open', () => {
    render(<RecordingLightbox src="/demo/media/x.gif" alt="A recording" onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})
