import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DependencyRisk } from '../api/types'
import { DependencyRiskReportPane } from './DependencyRiskReportPane'

function makeRisk(overrides: Partial<DependencyRisk> & { package: string }): DependencyRisk {
  return {
    version: '1.0.0',
    ecosystem: 'PyPI',
    vulnerabilities: [],
    importer_node_ids: [],
    ...overrides,
  }
}

describe('DependencyRiskReportPane', () => {
  it('shows an empty-state message when there are no risks', () => {
    render(
      <DependencyRiskReportPane risks={[]} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    expect(
      screen.getByText('No packages this repo actually imports matched a declared dependency.'),
    ).toBeInTheDocument()
  })

  it('renders a tile per package, with a link per vulnerability', () => {
    const risks: DependencyRisk[] = [
      makeRisk({
        package: 'requests',
        version: '2.31.0',
        vulnerabilities: [{ id: 'GHSA-fake-1234' }],
      }),
    ]
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    expect(screen.getByText('requests')).toBeInTheDocument()
    expect(screen.getByText('2.31.0 · PyPI')).toBeInTheDocument()
    expect(screen.getByTitle('GHSA-fake-1234')).toBeInTheDocument()
  })

  it('shows "No known vulnerabilities" for a clean package', () => {
    const risks: DependencyRisk[] = [makeRisk({ package: 'httpx', version: '0.28.1' })]
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    expect(screen.getByText('No known vulnerabilities')).toBeInTheDocument()
  })

  it('renders "unknown version" when a package has no resolvable version', () => {
    const risks: DependencyRisk[] = [makeRisk({ package: 'weird-pkg', version: null })]
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    expect(screen.getByText('unknown version · PyPI')).toBeInTheDocument()
  })

  it('sorts vulnerable packages first', () => {
    const risks: DependencyRisk[] = [
      makeRisk({ package: 'aaa-clean' }),
      makeRisk({ package: 'zzz-vulnerable', vulnerabilities: [{ id: 'GHSA-1' }] }),
    ]
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    const names = screen.getAllByText(/-clean$|-vulnerable$/).map((el) => el.textContent)
    expect(names).toEqual(['zzz-vulnerable', 'aaa-clean'])
  })

  it('shows a summary of packages scanned, vulnerable, and total advisories', () => {
    const risks: DependencyRisk[] = [
      makeRisk({ package: 'requests', vulnerabilities: [{ id: 'GHSA-1' }, { id: 'GHSA-2' }] }),
      makeRisk({ package: 'httpx' }),
    ]
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    expect(
      screen.getByText((_, node) => node?.textContent === '2 packages scanned · 1 with known vulnerabilities · 2 total advisories'),
    ).toBeInTheDocument()
  })

  it('calls onSelectPackage with the package name when a tile is clicked', async () => {
    const onSelectPackage = vi.fn()
    const user = userEvent.setup()
    const risks: DependencyRisk[] = [makeRisk({ package: 'requests' })]
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={onSelectPackage} />,
    )

    await user.click(screen.getByText('requests'))

    expect(onSelectPackage).toHaveBeenCalledWith('requests')
  })

  it('filters by package name', async () => {
    const risks: DependencyRisk[] = [makeRisk({ package: 'requests' }), makeRisk({ package: 'flask' })]
    const user = userEvent.setup()
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    await user.type(screen.getByLabelText('Filter packages'), 'req')

    expect(screen.getByText('requests')).toBeInTheDocument()
    expect(screen.queryByText('flask')).not.toBeInTheDocument()
  })

  it('shows a no-match message when the filter excludes every package', async () => {
    const risks: DependencyRisk[] = [makeRisk({ package: 'requests' })]
    const user = userEvent.setup()
    render(
      <DependencyRiskReportPane risks={risks} selectedPackage={null} onSelectPackage={vi.fn()} />,
    )

    await user.type(screen.getByLabelText('Filter packages'), 'nonexistent')

    expect(screen.getByText('No packages match this filter.')).toBeInTheDocument()
  })
})
