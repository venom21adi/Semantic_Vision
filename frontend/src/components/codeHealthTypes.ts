import type {
  ComplexityDiffResponse,
  ComplexityRefDiffResponse,
  ComplexityScore,
  CoverageIngestResponse,
  CoverageResponse,
  DeadCodeResponse,
  DependencyRiskResponse,
  DuplicatesResponse,
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

/** The Coverage tab's data -- same lazy-fetch-on-first-open treatment as
 * `HotspotsState`/`DeadCodeState`. `'loaded'` covers both "nothing ingested
 * yet" (`result.available === false`, prompting the ingest form) and "here's
 * the ranking" (`result.available === true`) -- one status, not two, since
 * both are a successful fetch of the same endpoint. */
export type CoverageState =
  | { status: 'loading' }
  | { status: 'loaded'; result: CoverageResponse }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

/** The coverage-file ingest form's own submission state, tracked separately
 * from `CoverageState` -- ingesting and viewing results are two different
 * user actions (mirrors `DataSourcePane`'s own ingest-form state shape),
 * and a re-ingest shouldn't blank out an already-rendered ranked list while
 * it's in flight. */
export type CoverageIngestState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; result: CoverageIngestResponse }
  | { status: 'error'; message: string }

/** The Duplicates tab's data -- same lazy-fetch-on-first-open treatment as
 * `HotspotsState`/`DeadCodeState`/`CoverageState`. Fully local/offline (no
 * ingested file, no git dependency), so there's no `'unavailable'` variant
 * the way `DeadCodeState`/`CoverageState` need for demo mode -- the demo's
 * `getDuplicates` stub returns a real, valid empty result instead. */
export type DuplicatesState =
  | { status: 'loading' }
  | { status: 'loaded'; result: DuplicatesResponse }
  | { status: 'error'; message: string }

/** The Dependencies tab's data. Unlike every other tab, there's no `null`
 * "not yet fetched" state and no lazy-fetch-on-first-open -- opening this
 * tab does nothing by itself, since it's the one opt-in, network-calling
 * feature in the app; `'idle'` is the real default, and a scan only ever
 * starts from an explicit button click (see `CodeHealthSidebar.tsx`'s
 * `DependenciesPane`). `'unavailable'` is demo-mode only, mirroring
 * `CoverageState`'s own use of that status for the same reason -- the
 * real backend's own "osv.dev query failed" case is instead carried by a
 * successful `'loaded'` fetch with `result.available === false`. */
export type DependencyRiskState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'loaded'; result: DependencyRiskResponse }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

export type HealthTab =
  | 'complexity'
  | 'hotspots'
  | 'dead-code'
  | 'coverage'
  | 'duplicates'
  | 'dependencies'
  | 'recommendations'

/** The Recommendations tab's data -- unlike every ranked-list tab, this
 * isn't fetched eagerly or lazily-on-first-open; it only ever starts from
 * an explicit "Generate" click (mirrors `DependencyRiskState`'s own
 * opt-in shape, since a click here can itself trigger a real AI-provider
 * call). `markdown` accumulates across `'generating'` -> `'loaded'` the
 * same way `DocPane`'s own streaming pane does. */
export type RecommendationsState =
  | { status: 'idle' }
  | { status: 'generating'; markdown: string }
  | { status: 'loaded'; markdown: string }
  | { status: 'error'; message: string }
