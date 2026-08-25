import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { isWithinRoot, toRelativePath } from './paths'

const root = path.join('workspace', 'Project')

describe('toRelativePath', () => {
  it('returns a forward-slash relative path regardless of OS separator', () => {
    const absolute = path.join(root, 'src', 'app.py')

    expect(toRelativePath(root, absolute)).toBe('src/app.py')
  })
})

describe('isWithinRoot', () => {
  it('is true for a file nested inside the root', () => {
    expect(isWithinRoot(root, path.join(root, 'src', 'app.py'))).toBe(true)
  })

  it('is false for a sibling directory sharing a name prefix with the root', () => {
    // The exact bug test-critic caught: a plain `startsWith` check on
    // ".../Project" would incorrectly match ".../ProjectX/file.py".
    const sibling = path.join('workspace', 'ProjectX', 'file.py')

    expect(isWithinRoot(root, sibling)).toBe(false)
  })

  it('is false for a file outside the root entirely', () => {
    expect(isWithinRoot(root, path.join('workspace', 'other', 'file.py'))).toBe(false)
  })

  it('is false for the root path itself', () => {
    expect(isWithinRoot(root, root)).toBe(false)
  })
})
