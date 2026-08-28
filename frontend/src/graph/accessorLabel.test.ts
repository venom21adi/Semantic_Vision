import { describe, expect, it } from 'vitest'
import { formatNodeLabel } from './accessorLabel'

describe('formatNodeLabel', () => {
  it('prefixes a getter with "get "', () => {
    expect(formatNodeLabel('value', 'get')).toBe('get value')
  })

  it('prefixes a setter with "set "', () => {
    expect(formatNodeLabel('value', 'set')).toBe('set value')
  })

  it('returns the bare label for a plain method', () => {
    expect(formatNodeLabel('plain', null)).toBe('plain')
  })

  it('returns the bare label when accessorKind is undefined', () => {
    expect(formatNodeLabel('plain')).toBe('plain')
  })
})
