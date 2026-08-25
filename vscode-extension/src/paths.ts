import * as path from 'path'

/** Workspace-relative, forward-slash path -- matches the `id`/`file`
 * format the backend's graph nodes already use
 * (`resolver/symbol_table.py`), regardless of the OS path separator. */
export function toRelativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/**
 * True only if `absolute` is actually inside `root` -- a real
 * containment check via `path.relative`, not the plain-string
 * `absolute.startsWith(root)` this replaces. That check is wrong for
 * sibling directories sharing a prefix (a workspace root of
 * `.../Project` would incorrectly match a sibling `.../ProjectX/file.py`
 * -- `path.relative` in that case returns something starting with `..`,
 * which this rejects. Also rejects the cross-drive-on-Windows case,
 * where `path.relative` falls back to returning `absolute` itself
 * (still absolute) rather than a relative path.
 */
export function isWithinRoot(root: string, absolute: string): boolean {
  const relative = path.relative(root, absolute)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
