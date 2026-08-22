import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLastRepoPath, setLastRepoPath } from './localStorage'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('localStorage helpers', () => {
  it('returns null when nothing has been saved', () => {
    expect(getLastRepoPath()).toBeNull()
  })

  it('round-trips a saved path', () => {
    setLastRepoPath('/some/repo')

    expect(getLastRepoPath()).toBe('/some/repo')
  })

  it('getLastRepoPath degrades to null when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(getLastRepoPath()).toBeNull()
  })

  it('setLastRepoPath does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(() => setLastRepoPath('/some/repo')).not.toThrow()
  })
})
