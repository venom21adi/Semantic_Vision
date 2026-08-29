const LAST_REPO_PATH_KEY = 'semantic-vision:last-repo-path'

export function getLastRepoPath(): string | null {
  try {
    return localStorage.getItem(LAST_REPO_PATH_KEY)
  } catch {
    // localStorage can throw (private browsing, disabled storage); the
    // app should degrade to "no remembered path", not crash.
    return null
  }
}

export function setLastRepoPath(path: string): void {
  try {
    localStorage.setItem(LAST_REPO_PATH_KEY, path)
  } catch {
    // Best-effort only.
  }
}

const DOC_ROOTS_KEY = 'semantic-vision:doc-roots'
const DOC_SAVE_NOTICE_DISMISSED_KEY = 'semantic-vision:doc-save-notice-dismissed'

function readDocRoots(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DOC_ROOTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function getRememberedDocRoot(repoPath: string): string | null {
  return readDocRoots()[repoPath] ?? null
}

export function setRememberedDocRoot(repoPath: string, docRoot: string): void {
  try {
    const roots = readDocRoots()
    roots[repoPath] = docRoot
    localStorage.setItem(DOC_ROOTS_KEY, JSON.stringify(roots))
  } catch {
    // Best-effort only.
  }
}

const LANGUAGES_KEY = 'semantic-vision:languages'

function readLanguages(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LANGUAGES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function getRememberedLanguage(repoPath: string): string | null {
  return readLanguages()[repoPath] ?? null
}

export function setRememberedLanguage(repoPath: string, language: string): void {
  try {
    const languages = readLanguages()
    languages[repoPath] = language
    localStorage.setItem(LANGUAGES_KEY, JSON.stringify(languages))
  } catch {
    // Best-effort only.
  }
}

export function isDocSaveNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(DOC_SAVE_NOTICE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissDocSaveNotice(): void {
  try {
    localStorage.setItem(DOC_SAVE_NOTICE_DISMISSED_KEY, '1')
  } catch {
    // Best-effort only.
  }
}

const SIDEBAR_COLLAPSED_KEY = 'semantic-vision:sidebar-collapsed'
const DETAILS_COLLAPSED_KEY = 'semantic-vision:details-collapsed'

export function getSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Best-effort only.
  }
}

export function getDetailsCollapsed(): boolean {
  try {
    return localStorage.getItem(DETAILS_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function setDetailsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(DETAILS_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Best-effort only.
  }
}

const DETAILS_WIDTH_KEY = 'semantic-vision:details-width'

export function getDetailsWidth(): number | null {
  try {
    const raw = localStorage.getItem(DETAILS_WIDTH_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function setDetailsWidth(width: number): void {
  try {
    localStorage.setItem(DETAILS_WIDTH_KEY, String(width))
  } catch {
    // Best-effort only.
  }
}
