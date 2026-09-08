import type {
  ComplexityDiffResponse,
  ComplexityRefDiffResponse,
  ComplexityScore,
  DeadCodeResponse,
  HotspotsResponse,
} from '../api/types'

/** Shared state shapes for the Code Health lens (`App.tsx`,
 * `CodeHealthSidebar.tsx`, `CodeHealthDetail.tsx`) -- pulled out on their
 * own since the lens's list and detail columns render in two different
 * places in `App.tsx`'s tree, not as parent/child, so neither owns these
 * types. */

export type DashboardState =
  | { status: 'loading' }
  | { status: 'loaded'; scores: ComplexityScore[] }
  | { status: 'error'; message: string }

/** Tags *how* a `DiffState`'s result was produced -- "vs last look" or "vs
 * an arbitrary git ref." One `DiffState` shape handles both rather than
 * two parallel state variables: a second Code-Health-scoped state slice
 * not wired into every reset/invalidate call site is exactly the shape of
 * bug this lens has shipped twice already (see `App.tsx`'s
 * `resetHealthState`). */
export type DiffMode =
  | { kind: 'last-look' }
  | { kind: 'ref'; ref: string; label: string; toRef?: string; toLabel?: string }

export type DiffState =
  | { status: 'loading'; mode: DiffMode }
  | { status: 'loaded'; mode: DiffMode; result: ComplexityDiffResponse | ComplexityRefDiffResponse }
  | { status: 'error'; mode: DiffMode; message: string }

/** The Hotspots tab's data, lazily fetched -- unlike `DashboardState`/
 * `gitRefs`, which both fetch eagerly the moment the Code Health lens
 * activates, this is only requested the first time the Hotspots tab is
 * actually selected. `windowDays` travels with each variant so a response
 * can always be matched back to the selector value that requested it. */
export type HotspotsState =
  | { status: 'loading'; windowDays: number }
  | { status: 'loaded'; windowDays: number; result: HotspotsResponse }
  | { status: 'error'; windowDays: number; message: string }

/** The Dead Code tab's data -- same lazy-fetch-on-first-open treatment as
 * `HotspotsState` above. No parameter to carry alongside each variant
 * (unlike `HotspotsState`'s `windowDays`): dead-code detection has no
 * user-adjustable input, it's just "recompute against the current
 * parse." */
export type DeadCodeState =
  | { status: 'loading' }
  | { status: 'loaded'; result: DeadCodeResponse }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

export type HealthTab = 'complexity' | 'hotspots' | 'dead-code'
