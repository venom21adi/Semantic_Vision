import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  ComplexityDiffResponse,
  ComplexityRefDiffResponse,
  ComplexityScore,
  GraphNode,
  HotspotScore,
} from '../api/types'
import { DashboardView } from './DashboardView'

const scores: ComplexityScore[] = [
  { node_id: 'app.py::handler', cyclomatic_complexity: 4, call_chain_depth: 1, has_nested_loops: false },
]

const graphNodes: GraphNode[] = [
  { id: 'app.py::handler', kind: 'function', label: 'handler', file: 'app.py', line_start: 1, line_end: 2 },
]

function renderDashboard(overrides: Partial<React.ComponentProps<typeof DashboardView>> = {}) {
  const props: React.ComponentProps<typeof DashboardView> = {
    state: { status: 'loaded', scores },
    path: '/repo',
    onSelectNode: vi.fn(),
    onBack: vi.fn(),
    diff: null,
    onCompare: vi.fn(),
    gitRefs: null,
    onCompareToRef: vi.fn(),
    graphNodes,
    graphEdges: [],
    selectedNodeId: null,
    hotspots: null,
    onLoadHotspots: vi.fn(),
    ...overrides,
  }
  return { ...render(<DashboardView {...props} />), props }
}

describe('DashboardView', () => {
  it('shows a loading message', () => {
    renderDashboard({ state: { status: 'loading' } })

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    renderDashboard({ state: { status: 'error', message: 'boom' } })

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('renders the ranked report when loaded', () => {
    renderDashboard()

    expect(screen.getByText('Code Health Dashboard')).toBeInTheDocument()
    expect(screen.getByText(/app\.py::handler/)).toBeInTheDocument()
  })

  it('renders the summary stats header when loaded', () => {
    renderDashboard()

    expect(screen.getByText('Functions scored')).toBeInTheDocument()
    expect(screen.getByText('Max call depth')).toBeInTheDocument()
  })

  it('renders the mini call graph pane', () => {
    renderDashboard()

    expect(screen.getByText('handler')).toBeInTheDocument()
  })

  it('calls onBack when "Back to graph" is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderDashboard()

    await user.click(screen.getByRole('button', { name: 'Back to graph' }))

    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('disables Compare while the dashboard itself is still loading', () => {
    renderDashboard({ state: { status: 'loading' } })

    expect(screen.getByRole('button', { name: 'Compare to last look' })).toBeDisabled()
  })

  it('calls onCompare when Compare to last look is clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderDashboard()

    await user.click(screen.getByRole('button', { name: 'Compare to last look' }))

    expect(props.onCompare).toHaveBeenCalledTimes(1)
  })

  it('disables Compare and shows a comparing label while a last-look compare is in flight', () => {
    renderDashboard({ diff: { status: 'loading', mode: { kind: 'last-look' } } })

    const button = screen.getByRole('button', { name: 'Comparing…' })
    expect(button).toBeDisabled()
  })

  it('shows a comparing message in the results area while loading', () => {
    renderDashboard({ diff: { status: 'loading', mode: { kind: 'last-look' } } })

    expect(screen.getAllByText('Comparing…').length).toBeGreaterThan(0)
  })

  it('shows a diff error message', () => {
    renderDashboard({ diff: { status: 'error', mode: { kind: 'last-look' }, message: 'diff boom' } })

    expect(screen.getByRole('alert')).toHaveTextContent('diff boom')
  })

  it('shows a no-baseline note when the diff is unavailable', () => {
    const result: ComplexityDiffResponse = { available: false, current: scores, added: [], removed: [], changed: [] }
    renderDashboard({ diff: { status: 'loaded', mode: { kind: 'last-look' }, result } })

    expect(screen.getByText(/No earlier snapshot/)).toBeInTheDocument()
  })

  it('shows a no-changes message when nothing changed', () => {
    const result: ComplexityDiffResponse = { available: true, current: scores, added: [], removed: [], changed: [] }
    renderDashboard({ diff: { status: 'loaded', mode: { kind: 'last-look' }, result } })

    expect(screen.getByText('No changes vs last look.')).toBeInTheDocument()
  })

  it('shows a ref-labeled no-changes message when comparing against a commit', () => {
    const result: ComplexityRefDiffResponse = {
      ref: 'abc1234',
      to_ref: null,
      available: true,
      current: scores,
      added: [],
      removed: [],
      changed: [],
    }
    renderDashboard({
      diff: { status: 'loaded', mode: { kind: 'ref', ref: 'abc1234', label: 'abc1234 fix it' }, result },
    })

    expect(screen.getByText('No changes vs abc1234 fix it.')).toBeInTheDocument()
  })

  it('shows an arrow-style label when comparing two arbitrary refs against each other', () => {
    const result: ComplexityRefDiffResponse = {
      ref: 'abc1234',
      to_ref: 'def5678',
      available: true,
      current: scores,
      added: [],
      removed: [],
      changed: [],
    }
    renderDashboard({
      diff: {
        status: 'loaded',
        mode: { kind: 'ref', ref: 'abc1234', label: 'abc1234', toRef: 'def5678', toLabel: 'def5678' },
        result,
      },
    })

    expect(screen.getByText('No changes abc1234 → def5678.')).toBeInTheDocument()
  })

  it('renders added, removed, and changed sections and only removed rows are non-clickable', async () => {
    const user = userEvent.setup()
    const result: ComplexityDiffResponse = {
      available: true,
      current: scores,
      added: [
        { node_id: 'app.py::new_fn', cyclomatic_complexity: 2, call_chain_depth: 0, has_nested_loops: false },
      ],
      removed: [
        { node_id: 'app.py::gone_fn', cyclomatic_complexity: 3, call_chain_depth: 0, has_nested_loops: false },
      ],
      changed: [
        {
          node_id: 'app.py::handler',
          before: { node_id: 'app.py::handler', cyclomatic_complexity: 2, call_chain_depth: 0, has_nested_loops: false },
          after: { node_id: 'app.py::handler', cyclomatic_complexity: 4, call_chain_depth: 1, has_nested_loops: false },
        },
      ],
    }
    const { props } = renderDashboard({ diff: { status: 'loaded', mode: { kind: 'last-look' }, result } })

    expect(screen.getByText(/Added/)).toBeInTheDocument()
    expect(screen.getByText(/Removed/)).toBeInTheDocument()
    expect(screen.getByText(/Changed/)).toBeInTheDocument()

    // Removed entries render as plain text, not a clickable button --
    // selecting a node that no longer exists would silently do nothing.
    expect(screen.queryByRole('button', { name: /gone_fn/ })).not.toBeInTheDocument()
    expect(screen.getByText(/app\.py::gone_fn/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /new_fn/ }))
    expect(props.onSelectNode).toHaveBeenCalledWith('app.py::new_fn')
  })

  it('does not render the ref picker when the loaded repo is not a git repo', () => {
    renderDashboard({ gitRefs: { status: 'loaded', refs: { is_git_repo: false, branches: [], commits: [] } } })

    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('renders the ref picker and calls onCompareToRef with just the "from" ref', async () => {
    const user = userEvent.setup()
    const { props } = renderDashboard({
      gitRefs: { status: 'loaded', refs: { is_git_repo: true, branches: ['main'], commits: [] } },
    })

    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(props.onCompareToRef).toHaveBeenCalledWith('main', 'main', undefined, undefined)
  })

  it('calls onCompareToRef with both refs when the optional "to" field is filled in', async () => {
    const user = userEvent.setup()
    const { props } = renderDashboard({
      gitRefs: { status: 'loaded', refs: { is_git_repo: true, branches: ['main', 'feature'], commits: [] } },
    })

    await user.type(screen.getByLabelText('Git ref to compare against'), 'main')
    await user.type(
      screen.getByLabelText('Second git ref to compare against (optional, defaults to the current state)'),
      'feature',
    )
    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(props.onCompareToRef).toHaveBeenCalledWith('main', 'main', 'feature', 'feature')
  })

  const hotspotScores: HotspotScore[] = [
    { node_id: 'app.py::hot', cyclomatic_complexity: 3, change_count: 4, hotspot_score: 12 },
  ]

  it('calls onLoadHotspots(90) exactly once the first time the Hotspots tab is opened', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderDashboard()

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(props.onLoadHotspots).toHaveBeenCalledTimes(1)
    expect(props.onLoadHotspots).toHaveBeenCalledWith(90)

    // Simulate the fetch resolving -- in the real app, `App.tsx`'s
    // `handleLoadHotspots` would now pass a non-null `hotspots` prop, so a
    // later reselect must not fetch again.
    rerender(
      <DashboardView
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
    const { props } = renderDashboard({
      hotspots: { status: 'loaded', windowDays: 90, result: { is_git_repo: true, scores: hotspotScores, window_days: 90 } },
    })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(props.onLoadHotspots).not.toHaveBeenCalled()
  })

  it('shows the loading state while hotspots are loading', async () => {
    const user = userEvent.setup()
    renderDashboard({ hotspots: { status: 'loading', windowDays: 90 } })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message when hotspots fail to load', async () => {
    const user = userEvent.setup()
    renderDashboard({ hotspots: { status: 'error', windowDays: 90, message: 'hotspot boom' } })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByRole('alert')).toHaveTextContent('hotspot boom')
  })

  it('shows a not-a-git-repo message on the Hotspots tab', async () => {
    const user = userEvent.setup()
    renderDashboard({
      hotspots: { status: 'loaded', windowDays: 90, result: { is_git_repo: false, scores: [], window_days: 90 } },
    })

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))

    expect(screen.getByText(/Not a git repository/)).toBeInTheDocument()
  })

  it('renders the ranked hotspot list once loaded', async () => {
    const user = userEvent.setup()
    renderDashboard({
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
    const { props } = renderDashboard({
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

  it('keeps the complexity split view unaffected when switching back from Hotspots', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(screen.getByRole('button', { name: 'Hotspots' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))

    expect(screen.getByText('Functions scored')).toBeInTheDocument()
    expect(screen.getByText('handler')).toBeInTheDocument()
  })
})
