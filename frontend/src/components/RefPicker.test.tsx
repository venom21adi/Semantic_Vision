import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GitRefsResponse } from '../api/types'
import { RefPicker, type GitRefsState } from './RefPicker'

const gitRepoRefs: GitRefsResponse = {
  is_git_repo: true,
  branches: ['main', 'feature-x'],
  commits: [{ sha: 'abc1234', subject: 'fix the thing' }],
}

const TO_LABEL = 'Second git ref to compare against (optional, defaults to the current state)'

describe('RefPicker', () => {
  it('renders nothing while gitRefs is null', () => {
    const { container } = render(<RefPicker state={null} disabled={false} onCompare={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the loaded repo is not a git repo', () => {
    const state: GitRefsState = { status: 'loaded', refs: { is_git_repo: false, branches: [], commits: [] } }
    const { container } = render(<RefPicker state={state} disabled={false} onCompare={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on an error state', () => {
    const state: GitRefsState = { status: 'error', message: 'boom' }
    const { container } = render(<RefPicker state={state} disabled={false} onCompare={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('populates the datalist from branches and commits', () => {
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    const { container } = render(<RefPicker state={state} disabled={false} onCompare={vi.fn()} />)

    const optionValues = Array.from(container.querySelectorAll('option')).map((o) => o.value)
    expect(optionValues).toEqual(['main', 'feature-x', 'abc1234'])
    expect(screen.getByText('fix the thing').tagName).toBe('OPTION')
  })

  it('calls onCompare with just the "from" ref and its resolved label when "to" is left blank', async () => {
    const onCompare = vi.fn()
    const user = userEvent.setup()
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    render(<RefPicker state={state} disabled={false} onCompare={onCompare} />)

    await user.type(screen.getByLabelText('Git ref to compare against'), 'abc1234')
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(onCompare).toHaveBeenCalledWith('abc1234', 'abc1234 fix the thing', undefined, undefined)
  })

  it('calls onCompare with the raw value as its own label for an arbitrary typed ref', async () => {
    const onCompare = vi.fn()
    const user = userEvent.setup()
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    render(<RefPicker state={state} disabled={false} onCompare={onCompare} />)

    await user.type(screen.getByLabelText('Git ref to compare against'), 'deadbee')
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(onCompare).toHaveBeenCalledWith('deadbee', 'deadbee', undefined, undefined)
  })

  it('calls onCompare with both refs and their resolved labels when "to" is filled in', async () => {
    const onCompare = vi.fn()
    const user = userEvent.setup()
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    render(<RefPicker state={state} disabled={false} onCompare={onCompare} />)

    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.type(screen.getByLabelText(TO_LABEL), 'abc1234')
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(onCompare).toHaveBeenCalledWith('main', 'main', 'abc1234', 'abc1234 fix the thing')
  })

  it('does not require the "to" field to be a recognized ref', async () => {
    const onCompare = vi.fn()
    const user = userEvent.setup()
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    render(<RefPicker state={state} disabled={false} onCompare={onCompare} />)

    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.type(screen.getByLabelText(TO_LABEL), 'deadbee')
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(onCompare).toHaveBeenCalledWith('main', 'main', 'deadbee', 'deadbee')
  })

  it('disables the Compare button while the "from" field is empty, even with "to" filled in', async () => {
    const user = userEvent.setup()
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    render(<RefPicker state={state} disabled={false} onCompare={vi.fn()} />)

    await user.type(screen.getByLabelText(TO_LABEL), 'abc1234')

    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled()
  })

  it('disables the Compare button while refs are still loading', () => {
    const state: GitRefsState = { status: 'loading' }
    render(<RefPicker state={state} disabled={false} onCompare={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled()
  })

  it('disables the Compare button when the disabled prop is set', () => {
    const state: GitRefsState = { status: 'loaded', refs: gitRepoRefs }
    render(<RefPicker state={state} disabled onCompare={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled()
  })
})
