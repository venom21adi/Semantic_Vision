import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dismissDocSaveNotice,
  getDetailsCollapsed,
  getLastRepoPath,
  getRememberedDocRoot,
  getRememberedLanguages,
  getSidebarCollapsed,
  isDocSaveNoticeDismissed,
  setDetailsCollapsed,
  setLastRepoPath,
  setRememberedDocRoot,
  setRememberedLanguages,
  setSidebarCollapsed,
} from './localStorage'

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

  it('returns null for a doc root that was never remembered', () => {
    expect(getRememberedDocRoot('/some/repo')).toBeNull()
  })

  it('round-trips a remembered doc root per repo path', () => {
    setRememberedDocRoot('/repo-a', '/save/a')
    setRememberedDocRoot('/repo-b', '/save/b')

    expect(getRememberedDocRoot('/repo-a')).toBe('/save/a')
    expect(getRememberedDocRoot('/repo-b')).toBe('/save/b')
  })

  it('overwrites a previously remembered doc root for the same repo path', () => {
    setRememberedDocRoot('/repo-a', '/save/a')
    setRememberedDocRoot('/repo-a', '/save/a-new')

    expect(getRememberedDocRoot('/repo-a')).toBe('/save/a-new')
  })

  it('returns null for languages that were never remembered', () => {
    expect(getRememberedLanguages('/some/repo')).toBeNull()
  })

  it('round-trips remembered languages per repo path', () => {
    setRememberedLanguages('/repo-a', ['python'])
    setRememberedLanguages('/repo-b', ['python', 'javascript'])

    expect(getRememberedLanguages('/repo-a')).toEqual(['python'])
    expect(getRememberedLanguages('/repo-b')).toEqual(['python', 'javascript'])
  })

  it('ignores a legacy single-string value stored under the same key', () => {
    // This key predates multi-language support, when it stored one plain
    // string per path instead of `string[]` -- an install that used the
    // app before that change still has old string values sitting here.
    // Regression test: trusting one as-is fed `new Set("javascript")`
    // into `RepoLoader`'s selection state, which split it into individual
    // characters and submitted each as its own invalid `language` on
    // Load (surfacing as a baffling "Unknown language: 't'" backend
    // error, the one specific letter varying by request-race timing).
    localStorage.setItem(
      'semantic-vision:languages',
      JSON.stringify({ '/legacy-repo': 'javascript' }),
    )

    expect(getRememberedLanguages('/legacy-repo')).toBeNull()
  })

  it('ignores a legacy value whose array contains non-string entries', () => {
    localStorage.setItem(
      'semantic-vision:languages',
      JSON.stringify({ '/repo': ['python', 42] }),
    )

    expect(getRememberedLanguages('/repo')).toBeNull()
  })

  it('the doc-save notice starts un-dismissed and can be dismissed', () => {
    expect(isDocSaveNoticeDismissed()).toBe(false)

    dismissDocSaveNotice()

    expect(isDocSaveNoticeDismissed()).toBe(true)
  })

  it('the sidebar starts expanded and round-trips a collapsed state', () => {
    expect(getSidebarCollapsed()).toBe(false)

    setSidebarCollapsed(true)
    expect(getSidebarCollapsed()).toBe(true)

    setSidebarCollapsed(false)
    expect(getSidebarCollapsed()).toBe(false)
  })

  it('getSidebarCollapsed degrades to false when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(getSidebarCollapsed()).toBe(false)
  })

  it('setSidebarCollapsed does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(() => setSidebarCollapsed(true)).not.toThrow()
  })

  it('the details panel starts expanded and round-trips a collapsed state', () => {
    expect(getDetailsCollapsed()).toBe(false)

    setDetailsCollapsed(true)
    expect(getDetailsCollapsed()).toBe(true)

    setDetailsCollapsed(false)
    expect(getDetailsCollapsed()).toBe(false)
  })

  it('getDetailsCollapsed degrades to false when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(getDetailsCollapsed()).toBe(false)
  })

  it('setDetailsCollapsed does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(() => setDetailsCollapsed(true)).not.toThrow()
  })

  it('sidebar and details panel collapsed state are tracked independently', () => {
    setSidebarCollapsed(true)

    expect(getSidebarCollapsed()).toBe(true)
    expect(getDetailsCollapsed()).toBe(false)
  })
})
