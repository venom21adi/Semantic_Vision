import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComplexityScore,
  CoverageRiskScore,
  DeadCodeCandidate,
  DependencyRisk,
  DuplicateGroup,
  GraphNode,
  HotspotScore,
} from '../api/types'
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
    graphNodes,
    selectedNodeId: null,
    onSelectNode: vi.fn(),
    hotspots: null,
    onLoadHotspots: vi.fn(),
    deadCode: null,
    onLoadDeadCode: vi.fn(),
    coverage: null,
    onLoadCoverage: vi.fn(),
    coverageIngest: { status: 'idle' },
    onIngestCoverage: vi.fn(),
    duplicates: null,
    onLoadDuplicates: vi.fn(),
    dependencyRisk: { status: 'idle' },
    onScanDependencies: vi.fn(),
    ...overrides,
  }
  return { ...render(<Harness {...props} />), props }
}

describe('CodeHealthSidebar', () => {
  it('shows a loading message', () => {
    renderSidebar({ state: { status: 'loading' } })

    expect(screen.getByText('Analyzing complexity across the codebase…')).toBeInTheDocument()
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

    expect(screen.getByText('Computing churn history for every file…')).toBeInTheDocument()
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

    expect(screen.getByText('Scanning for functions with no callers…')).toBeInTheDocument()
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

  const coverageScores: CoverageRiskScore[] = [
    { node_id: 'app.py::risky', cyclomatic_complexity: 5, blast_radius: 1, coverage_ratio: 0, risk_score: 10 },
  ]

  it('calls onLoadCoverage exactly once the first time the Coverage tab is opened', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(props.onLoadCoverage).toHaveBeenCalledTimes(1)

    // Same "already have a result, a reselect must not refetch" contract
    // as the Hotspots/Dead code tabs above.
    rerender(
      <Harness {...props} coverage={{ status: 'loaded', result: { available: false, scores: [] } }} />,
    )
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(props.onLoadCoverage).toHaveBeenCalledTimes(1)
  })

  it('does not refetch coverage on reselect once a result already exists', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar({
      coverage: { status: 'loaded', result: { available: true, scores: coverageScores } },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(props.onLoadCoverage).not.toHaveBeenCalled()
  })

  it('shows the loading state while coverage is loading', async () => {
    const user = userEvent.setup()
    renderSidebar({ coverage: { status: 'loading' } })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByText('Computing coverage risk ranking…')).toBeInTheDocument()
  })

  it('shows an error message when coverage risk fails to load', async () => {
    const user = userEvent.setup()
    renderSidebar({ coverage: { status: 'error', message: 'coverage boom' } })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByRole('alert')).toHaveTextContent('coverage boom')
  })

  it('shows a graceful message on the Coverage tab when unavailable (demo mode)', async () => {
    const user = userEvent.setup()
    renderSidebar({
      coverage: { status: 'unavailable', message: 'Coverage ranking is not available in demo mode' },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByText('Coverage ranking is not available in demo mode')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('prompts to ingest a report when nothing has been ingested yet', async () => {
    const user = userEvent.setup()
    renderSidebar({ coverage: { status: 'loaded', result: { available: false, scores: [] } } })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByText(/No coverage report ingested yet/)).toBeInTheDocument()
  })

  it('renders the ranked coverage-risk list once loaded', async () => {
    const user = userEvent.setup()
    renderSidebar({
      coverage: { status: 'loaded', result: { available: true, scores: coverageScores } },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByText(/app\.py::risky/)).toBeInTheDocument()
  })

  it('submits the ingest form with the trimmed coverage path', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar({
      coverage: { status: 'loaded', result: { available: false, scores: [] } },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))
    await user.type(screen.getByLabelText('Coverage report path'), '  /repo/coverage.xml  ')
    await user.click(screen.getByRole('button', { name: 'Ingest' }))

    expect(props.onIngestCoverage).toHaveBeenCalledWith('/repo/coverage.xml')
  })

  it('shows the ingest success summary', async () => {
    const user = userEvent.setup()
    renderSidebar({
      coverage: { status: 'loaded', result: { available: false, scores: [] } },
      coverageIngest: {
        status: 'success',
        result: { files_in_report: 2, files_matched: 2, lines_recorded: 40 },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByRole('status')).toHaveTextContent('2 of 2 report files matched')
    expect(screen.getByRole('status')).toHaveTextContent('40 lines recorded.')
  })

  it('warns when the ingested report matched none of this repo\'s files', async () => {
    const user = userEvent.setup()
    renderSidebar({
      coverage: { status: 'loaded', result: { available: false, scores: [] } },
      coverageIngest: {
        status: 'success',
        result: { files_in_report: 3, files_matched: 0, lines_recorded: 40 },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByRole('alert')).toHaveTextContent("0 of 3 report files matched")
  })

  it('shows the ingest error message', async () => {
    const user = userEvent.setup()
    renderSidebar({
      coverage: { status: 'loaded', result: { available: false, scores: [] } },
      coverageIngest: { status: 'error', message: 'ingest boom' },
    })

    await user.click(screen.getByRole('button', { name: 'Coverage' }))

    expect(screen.getByRole('alert')).toHaveTextContent('ingest boom')
  })

  it('keeps the complexity list intact when switching back from Coverage', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Coverage' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))

    expect(screen.getByText('handler')).toBeInTheDocument()
  })

  const duplicateGroups: DuplicateGroup[] = [
    { node_ids: ['app.py::foo', 'app.py::bar'], size: 2 },
  ]

  it('calls onLoadDuplicates exactly once the first time the Duplicates tab is opened', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(props.onLoadDuplicates).toHaveBeenCalledTimes(1)

    rerender(<Harness {...props} duplicates={{ status: 'loaded', result: { groups: [] } }} />)
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(props.onLoadDuplicates).toHaveBeenCalledTimes(1)
  })

  it('does not refetch duplicates on reselect once a result already exists', async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar({
      duplicates: { status: 'loaded', result: { groups: duplicateGroups } },
    })

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))
    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(props.onLoadDuplicates).not.toHaveBeenCalled()
  })

  it('shows the loading state while duplicates are loading', async () => {
    const user = userEvent.setup()
    renderSidebar({ duplicates: { status: 'loading' } })

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(
      screen.getByText('Comparing every function\'s structure for exact-shape matches…'),
    ).toBeInTheDocument()
  })

  it('shows an error message when duplicate detection fails', async () => {
    const user = userEvent.setup()
    renderSidebar({ duplicates: { status: 'error', message: 'duplicates boom' } })

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(screen.getByRole('alert')).toHaveTextContent('duplicates boom')
  })

  it('renders the grouped duplicate list once loaded', async () => {
    const user = userEvent.setup()
    renderSidebar({
      duplicates: { status: 'loaded', result: { groups: duplicateGroups } },
    })

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(screen.getByText(/app\.py::foo/)).toBeInTheDocument()
  })

  it('shows an empty-state message when no duplicate groups are found', async () => {
    const user = userEvent.setup()
    renderSidebar({ duplicates: { status: 'loaded', result: { groups: [] } } })

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))

    expect(screen.getByText('No duplicate-function groups found.')).toBeInTheDocument()
  })

  it('keeps the complexity list intact when switching back from Duplicates', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Duplicates' }))
    await user.click(screen.getByRole('button', { name: 'Complexity' }))

    expect(screen.getByText('handler')).toBeInTheDocument()
  })

  describe('Dependencies tab', () => {
    afterEach(() => {
      localStorage.clear()
    })

    it('does not scan automatically when the tab is opened', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(props.onScanDependencies).not.toHaveBeenCalled()
    })

    it('disables the scan button until the consent checkbox is checked', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(screen.getByRole('button', { name: 'Scan dependencies' })).toBeDisabled()

      await user.click(screen.getByRole('checkbox'))

      expect(screen.getByRole('button', { name: 'Scan dependencies' })).toBeEnabled()
    })

    it('calls onScanDependencies only after the checkbox is checked and the button clicked', async () => {
      const user = userEvent.setup()
      const { props } = renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: 'Scan dependencies' }))

      expect(props.onScanDependencies).toHaveBeenCalledTimes(1)
    })

    it('pre-checks the consent checkbox when the user has consented before', async () => {
      const user = userEvent.setup()
      localStorage.setItem('semantic-vision:dependency-scan-consent', '1')
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(screen.getByRole('checkbox')).toBeChecked()
      expect(screen.getByRole('button', { name: 'Scan dependencies' })).toBeEnabled()
    })

    it('shows the loading state while a scan is in progress', async () => {
      const user = userEvent.setup()
      renderSidebar({ dependencyRisk: { status: 'submitting' } })

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(screen.getByText('Querying osv.dev for known vulnerabilities…')).toBeInTheDocument()
    })

    it('shows an error message when a scan fails', async () => {
      const user = userEvent.setup()
      renderSidebar({ dependencyRisk: { status: 'error', message: 'scan boom' } })

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(screen.getByRole('alert')).toHaveTextContent('scan boom')
    })

    it('shows a graceful message when unavailable (demo mode)', async () => {
      const user = userEvent.setup()
      renderSidebar({
        dependencyRisk: {
          status: 'unavailable',
          message: 'Dependency risk scanning is not available in demo mode',
        },
      })

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(
        screen.getByText('Dependency risk scanning is not available in demo mode'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows a graceful message when the backend reports osv.dev was unreachable', async () => {
      const user = userEvent.setup()
      renderSidebar({
        dependencyRisk: {
          status: 'loaded',
          result: { available: false, risks: [], message: 'Could not reach osv.dev: timeout' },
        },
      })

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(screen.getByText('Could not reach osv.dev: timeout')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('renders the risk list once loaded', async () => {
      const risks: DependencyRisk[] = [
        { package: 'requests', version: '2.31.0', ecosystem: 'PyPI', vulnerabilities: [] },
      ]
      const user = userEvent.setup()
      renderSidebar({
        dependencyRisk: { status: 'loaded', result: { available: true, risks, message: null } },
      })

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))

      expect(screen.getByText('requests')).toBeInTheDocument()
    })

    it('keeps the complexity list intact when switching back from Dependencies', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Dependencies' }))
      await user.click(screen.getByRole('button', { name: 'Complexity' }))

      expect(screen.getByText('handler')).toBeInTheDocument()
    })
  })
})
