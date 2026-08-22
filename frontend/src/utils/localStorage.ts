const LAST_REPO_PATH_KEY = 'acv-ad:last-repo-path'

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
