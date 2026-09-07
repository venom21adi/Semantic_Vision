import { useState } from 'react'
import type { GitRefsResponse } from '../api/types'
import { colors, radius, spacing } from '../theme'

export type GitRefsState =
  | { status: 'loading' }
  | { status: 'loaded'; refs: GitRefsResponse }
  | { status: 'error'; message: string }

interface RefPickerProps {
  state: GitRefsState | null
  disabled: boolean
  onCompare: (ref: string, label: string) => void
}

const inputStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
  width: 160,
} as const

const DATALIST_ID = 'sv-git-refs'

/** A "compare current state against a commit/branch" control -- a native
 * `<input list>` + `<datalist>` combo (zero new dependency) so a user can
 * both pick a recent branch/commit from the list and type an arbitrary
 * ref/sha the list doesn't happen to include, in one control. Renders
 * nothing once it's confirmed the loaded repo isn't a git repo at all --
 * there's nothing meaningful to compare against. */
export function RefPicker({ state, disabled, onCompare }: RefPickerProps) {
  const [value, setValue] = useState('')

  if (!state || state.status === 'error') return null
  if (state.status === 'loaded' && !state.refs.is_git_repo) return null

  const refs = state.status === 'loaded' ? state.refs : null
  const labelByRef = new Map<string, string>()
  refs?.branches.forEach((branch) => labelByRef.set(branch, branch))
  refs?.commits.forEach((commit) => labelByRef.set(commit.sha, `${commit.sha} ${commit.subject}`))

  const compareDisabled = disabled || state.status === 'loading' || value.trim() === ''

  return (
    <div style={{ display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
      <input
        list={DATALIST_ID}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={state.status === 'loading' ? 'Loading refs…' : 'commit or branch'}
        aria-label="Git ref to compare against"
        style={inputStyle}
      />
      <datalist id={DATALIST_ID}>
        {refs?.branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
        {refs?.commits.map((commit) => (
          <option key={commit.sha} value={commit.sha}>
            {commit.subject}
          </option>
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => onCompare(value.trim(), labelByRef.get(value.trim()) ?? value.trim())}
        disabled={compareDisabled}
        className="sv-interactive"
        style={{
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          color: compareDisabled ? colors.textDim : colors.textPrimary,
          padding: '4px 10px',
          fontSize: 12,
          cursor: compareDisabled ? 'default' : 'pointer',
        }}
      >
        Compare to commit
      </button>
    </div>
  )
}
