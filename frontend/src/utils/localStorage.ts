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
