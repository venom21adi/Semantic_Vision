import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dismissDocSaveNotice,
  getDetailsCollapsed,
  getLastRepoPath,
  getRememberedDocRoot,
  getSidebarCollapsed,
  isDocSaveNoticeDismissed,
  setDetailsCollapsed,
  setLastRepoPath,
  setRememberedDocRoot,
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
