import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComplexityScore, DeadCodeCandidate, GraphNode, HotspotScore } from '../api/types'
import { CodeHealthSidebar } from './CodeHealthSidebar'
import type { HealthTab } from './codeHealthTypes'

const scores: ComplexityScore[] = [
  { node_id: 'app.py::handler', cyclomatic_complexity: 4, call_chain_depth: 1, has_nested_loops: false },
]

const graphNodes: GraphNode[] = [
  { id: 'app.py::handler', kind: 'function', label: 'handler', file: 'app.py', line_start: 1, line_end: 2 },
]

type SidebarProps = React.ComponentProps<typeof CodeHealthSidebar>

// `healthTab` is a controlled prop (both `CodeHealthSidebar` and
// `CodeHealthDetail` need to agree on it in the real app, since they no
// longer render as parent/child -- see `App.tsx`). This harness owns that
// state locally so the tests can click tab buttons the same way a person
// would, mirroring how `App.tsx` itself wires it.
function Harness(props: Omit<SidebarProps, 'healthTab' | 'onHealthTabChange'>) {
  const [healthTab, setHealthTab] = useState<HealthTab>('complexity')
  return <CodeHealthSidebar {...props} healthTab={healthTab} onHealthTabChange={setHealthTab} />
}

function renderSidebar(overrides: Partial<Omit<SidebarProps, 'healthTab' | 'onHealthTabChange'>> = {}) {
  const props: Omit<SidebarProps, 'healthTab' | 'onHealthTabChange'> = {
    state: { status: 'loaded', scores },
    path: '/repo',
    graphNodes,
    selectedNodeId: null,
    onSelectNode: vi.fn(),
    hotspots: null,
    onLoadHotspots: vi.fn(),
    deadCode: null,
    onLoadDeadCode: vi.fn(),
    ...overrides,
  }
  return { ...render(<Harness {...props} />), props }
}

describe('CodeHealthSidebar', () => {
  it('shows a loading message', () => {
    renderSidebar({ state: { status: 'loading' } })

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    renderSidebar({ state: { status: 'error', message: 'boom' } })

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders the ranked report when loaded', () => {
    renderSidebar()

    expect(screen.getByText('handler')).toBeInTheDocument()
  })

  const hotspotScores: HotspotScore[] = [
    { node_id: 'app.py::hot', cyclomatic_complexity: 3, change_count: 4, hotspot_score: 12 },
  ]

  it('calls onLoadHotspots(90) exactly once the first time the Hotspots tab is opened', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(props.onLoadHotspots).toHaveBeenCalledTimes(1)
    expect(props.onLoadHotspots).toHaveBeenCalledWith(90)

    // Simulate the fetch resolving -- in the real app, `App.tsx`'s
    // `handleLoadHotspots` would now pass a non-null `hotspots` prop, so a
    // later reselect must not fetch again.
    rerender(
      <Harness
        {...props}
        hotspots={{ status: 'loaded', windowDays: 90, result: { is_git_repo: true, scores: [], window_days: 90 } }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(props.onLoadHotspots).toHaveBeenCalledTimes(1)
  })

  it('does not refetch hotspots on reselect once a result already exists', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar({
      hotspots: { status: 'loaded', windowDays: 90, result: { is_git_repo: true, scores: hotspotScores, window_days: 90 } },
    })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(props.onLoadHotspots).not.toHaveBeenCalled()
  })

  it('shows the loading state while hotspots are loading', async () => {
    const user = userEvent.setup()
    renderSidebar({ hotspots: { status: 'loading', windowDays: 90 } })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message when hotspots fail to load', async () => {
    const user = userEvent.setup()
    renderSidebar({ hotspots: { status: 'error', windowDays: 90, message: 'hotspot boom' } })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByRole('alert')).toHaveTextContent('hotspot boom')
  })

  it('shows a not-a-git-repo message on the Hotspots tab', async () => {
    const user = userEvent.setup()
    renderSidebar({
      hotspots: { status: 'loaded', windowDays: 90, result: { is_git_repo: false, scores: [], window_days: 90 } },
    })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByText(/Not a git repository/)).toBeInTheDocument()
  })

  it('renders the ranked hotspot list once loaded', async () => {
    const user = userEvent.setup()
    renderSidebar({
      hotspots: {
        status: 'loaded',
        windowDays: 90,
        result: { is_git_repo: true, scores: hotspotScores, window_days: 90 },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByText(/app\.py::hot/)).toBeInTheDocument()
  })

  it('calls onLoadHotspots with the new value when the window selector changes', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar({
      hotspots: {
        status: 'loaded',
        windowDays: 90,
        result: { is_git_repo: true, scores: hotspotScores, window_days: 90 },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await user.selectOptions(screen.getByLabelText('Window'), '30')

    expect(props.onLoadHotspots).toHaveBeenCalledWith(30)
  })

  it('keeps the complexity list intact when switching back from Hotspots', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))

    expect(screen.getByText('handler')).toBeInTheDocument()
  })

  const deadCodeCandidates: DeadCodeCandidate[] = [{ node_id: 'app.py::orphan' }]

  it('calls onLoadDeadCode exactly once the first time the Dead code tab is opened', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(props.onLoadDeadCode).toHaveBeenCalledTimes(1)

    // Same "already have a result, a reselect must not refetch" contract
    // as the Hotspots tab above.
    rerender(<Harness {...props} deadCode={{ status: 'loaded', result: { candidates: [] } }} />)
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(props.onLoadDeadCode).toHaveBeenCalledTimes(1)
  })

  it('does not refetch dead code on reselect once a result already exists', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar({
      deadCode: { status: 'loaded', result: { candidates: deadCodeCandidates } },
    })

    await user.click(screen.getByRole('button', { name: 'Dead code' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(props.onLoadDeadCode).not.toHaveBeenCalled()
  })

  it('shows the loading state while dead code is loading', async () => {
    const user = userEvent.setup()
    renderSidebar({ deadCode: { status: 'loading' } })

    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message when dead-code detection fails', async () => {
    const user = userEvent.setup()
    renderSidebar({ deadCode: { status: 'error', message: 'dead code boom' } })

    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(screen.getByRole('alert')).toHaveTextContent('dead code boom')
  })

  it('renders the candidate list once loaded', async () => {
    const user = userEvent.setup()
    renderSidebar({
      deadCode: { status: 'loaded', result: { candidates: deadCodeCandidates } },
    })

    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(screen.getByText(/app\.py::orphan/)).toBeInTheDocument()
  })

  it('shows a graceful message on the Dead code tab when unavailable (demo mode)', async () => {
    const user = userEvent.setup()
    renderSidebar({
      deadCode: { status: 'unavailable', message: 'Dead-code detection is not available in demo mode' },
    })

    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(screen.getByText('Dead-code detection is not available in demo mode')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when no candidates are found', async () => {
    const user = userEvent.setup()
    renderSidebar({ deadCode: { status: 'loaded', result: { candidates: [] } } })

    await user.click(screen.getByRole('button', { name: 'Dead code' }))

    expect(screen.getByText('No dead-code candidates found.')).toBeInTheDocument()
  })
})
