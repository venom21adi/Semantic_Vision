import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ComplexityScore } from '../api/types'
import { SummaryStatsHeader } from './SummaryStatsHeader'

function score(cc: number, depth: number): ComplexityScore {
  return { node_id: `n${cc}-${depth}`, cyclomatic_complexity: cc, call_chain_depth: depth, has_nested_loops: false }
}

describe('SummaryStatsHeader', () => {
  it('shows zero functions scored for an empty score set', () => {
    render(<SummaryStatsHeader scores={[]} />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Functions scored')).toBeInTheDocument()
  })

  it('computes total, average complexity, complex count, and max depth', () => {
    // MODERATE_MAX is 7 -- the 9 here is the one "complex" function.
    render(<SummaryStatsHeader scores={[score(1, 0), score(3, 2), score(9, 5)]} />)

    expect(screen.getByText('3')).toBeInTheDocument() // total
    expect(screen.getByText('4.3')).toBeInTheDocument() // avg = (1+3+9)/3
    expect(screen.getByText('Complex functions')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument() // max depth
  })

  it('reports zero complex functions when none exceed the threshold', () => {
    render(<SummaryStatsHeader scores={[score(1, 0), score(2, 1)]} />)

    const complexTile = screen.getByText('Complex functions').previousElementSibling
    expect(complexTile).toHaveTextContent('0')
  })
})
