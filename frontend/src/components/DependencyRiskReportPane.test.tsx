import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { DependencyRisk } from '../api/types'
import { DependencyRiskReportPane } from './DependencyRiskReportPane'

describe('DependencyRiskReportPane', () => {
  it('shows an empty-state message when there are no risks', () => {
    render(<DependencyRiskReportPane risks={[]} />)

    expect(
      screen.getByText('No packages this repo actually imports matched a declared dependency.'),
    ).toBeInTheDocument()
  })

  it('renders a row per package, with a link per vulnerability', () => {
    const risks: DependencyRisk[] = [
      {
        package: 'requests',
        version: '2.31.0',
        ecosystem: 'PyPI',
        vulnerabilities: [{ id: 'GHSA-fake-1234' }],
      },
    ]
    render(<DependencyRiskReportPane risks={risks} />)

    expect(screen.getByText('requests')).toBeInTheDocument()
    expect(screen.getByText('2.31.0 · PyPI')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GHSA-fake-1234' })).toHaveAttribute(
      'href',
      'https://osv.dev/vulnerability/GHSA-fake-1234',
    )
  })

  it('shows "No known vulnerabilities" for a clean package', () => {
    const risks: DependencyRisk[] = [
      { package: 'httpx', version: '0.28.1', ecosystem: 'PyPI', vulnerabilities: [] },
    ]
    render(<DependencyRiskReportPane risks={risks} />)

    expect(screen.getByText('No known vulnerabilities')).toBeInTheDocument()
  })

  it('renders "unknown version" when a package has no resolvable version', () => {
    const risks: DependencyRisk[] = [
      { package: 'weird-pkg', version: null, ecosystem: 'PyPI', vulnerabilities: [] },
    ]
    render(<DependencyRiskReportPane risks={risks} />)

    expect(screen.getByText('unknown version · PyPI')).toBeInTheDocument()
  })

  it('filters by package name', async () => {
    const risks: DependencyRisk[] = [
      { package: 'requests', version: '2.31.0', ecosystem: 'PyPI', vulnerabilities: [] },
      { package: 'flask', version: '3.0.0', ecosystem: 'PyPI', vulnerabilities: [] },
    ]
    const user = userEvent.setup()
    render(<DependencyRiskReportPane risks={risks} />)

    await user.type(screen.getByLabelText('Filter packages'), 'req')

    expect(screen.getByText('requests')).toBeInTheDocument()
    expect(screen.queryByText('flask')).not.toBeInTheDocument()
  })

  it('shows a no-match message when the filter excludes every package', async () => {
    const risks: DependencyRisk[] = [
      { package: 'requests', version: '2.31.0', ecosystem: 'PyPI', vulnerabilities: [] },
    ]
    const user = userEvent.setup()
    render(<DependencyRiskReportPane risks={risks} />)

    await user.type(screen.getByLabelText('Filter packages'), 'nonexistent')

    expect(screen.getByText('No packages match this filter.')).toBeInTheDocument()
  })
})
