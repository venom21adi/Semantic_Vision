import type {
  ComplexityDiffResponse,
  ComplexityRefDiffResponse,
  ComplexityResponse,
  CoverageIngestResponse,
  CoverageResponse,
  DbConnectionIngestResponse,
  DependencyRisk,
  DependencyRiskResponse,
  DuplicatesResponse,
  DbtManifestIngestResponse,
  DeadCodeResponse,
  DocIndexResponse,
  DocProvider,
  DocResponse,
  DocRootResponse,
  FlowchartResponse,
  FunctionSourceResponse,
  GitRefsResponse,
  GraphResponse,
  GraphStateResponse,
  HotspotsResponse,
  ImpactResponse,
  NodePosition,
  OllamaModelsResponse,
  ParseRepoResponse,
} from './types'
import * as demoClient from './demoClient'

declare global {
  interface Window {
    /** Set by the VS Code extension host, before this bundle's own script
     * tag, so one built `dist/` output can point at whatever backend port
     * the user has configured without a rebuild -- `VITE_API_BASE_URL` is
     * baked in at build time and can't serve that. Undefined for every
     * other load (plain browser, dev server), so this is a pure addition. */
    __SEMANTIC_VISION_API_BASE__?: string
  }
}

/** Build-time flag for the static, backend-free demo deploy (`vite build
 * --mode demo`, see frontend/.env.demo) -- every exported function below
 * switches to `demoClient`'s fixture-backed implementation when this is
 * set, so every consumer (App.tsx, DocPane, DataSourcePane, ...) works
 * unchanged in either build. */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

const API_BASE_URL: string =
  window.__SEMANTIC_VISION_API_BASE__ ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Thrown only by `getDeadCode`'s demo stub -- a distinct type (not a
 * plain `Error`) so `App.tsx`'s `handleLoadDeadCode` can tell "expected,
 * demo-only unavailability" apart from a real failure and route it to
 * `DeadCodeState`'s `'unavailable'` status instead of `'error'`. */
export class DeadCodeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeadCodeUnavailableError'
  }
}

/** Thrown only by `getDependencyRisk`'s demo stub -- this feature makes a
 * real external network call (to osv.dev), which is never appropriate in
 * a public demo build regardless of what a viewer clicks. Unlike
 * `CoverageUnavailableError`, there's no real-backend "unavailable" case
 * this mirrors -- the real backend only ever reports availability via
 * `DependencyRiskResponse.available` (an osv.dev query failure), which the
 * demo build can never legitimately reach in the first place. */
export class DependencyRiskUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DependencyRiskUnavailableError'
  }
}

/** Thrown only by `getCoverageRisk`/`ingestCoverage`'s demo stubs -- the
 * static demo has no user-supplied coverage report to ingest, and unlike
 * `getComplexityHotspots`'s stub, there's no real-world "unavailable" case
 * this route's own response schema already carries (a real backend's
 * `CoverageResponse.available` means "nothing ingested yet," not "this
 * feature doesn't work here"), so this stays a distinct demo-only signal,
 * same reasoning as `DeadCodeUnavailableError`. */
export class CoverageUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoverageUnavailableError'
  }
}

/** Thrown only by `streamCodeHealthRecommendations`'s demo stub -- this
 * route needs a real backend and a real AI provider, never fakeable in
 * the public demo (same flavor-(b) reasoning as
 * `DependencyRiskUnavailableError`/`CoverageUnavailableError`). */
export class RecommendationsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecommendationsUnavailableError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const detail =
      body && typeof body === 'object' && 'detail' in body ? String(body.detail) : undefined
    throw new ApiError(response.status, detail ?? response.statusText)
  }

  return response.json() as Promise<T>
}

function realParseRepo(
  path: string,
  docRoot?: string,
  language?: string,
): Promise<ParseRepoResponse> {
  return request<ParseRepoResponse>('/api/parse-repo', {
    method: 'POST',
    body: JSON.stringify({ path, doc_root: docRoot || undefined, language: language || undefined }),
  })
}

function realUpdateDocRoot(path: string, language: string, docRoot: string): Promise<DocRootResponse> {
  return request<DocRootResponse>(
    `/api/doc-root?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    { method: 'PUT', body: JSON.stringify({ doc_root: docRoot }) },
  )
}

function realGetGraph(path: string, language: string): Promise<GraphResponse> {
  return request<GraphResponse>(
    `/api/graph?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetFunctionSource(
  path: string,
  language: string,
  id: string,
): Promise<FunctionSourceResponse> {
  return request<FunctionSourceResponse>(
    `/api/function-source?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetGraphState(path: string, language: string): Promise<GraphStateResponse> {
  return request<GraphStateResponse>(
    `/api/graph-state?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realSaveGraphState(
  path: string,
  language: string,
  positions: Record<string, NodePosition>,
): Promise<GraphStateResponse> {
  return request<GraphStateResponse>(
    `/api/graph-state?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    { method: 'PUT', body: JSON.stringify({ positions }) },
  )
}

function realGetDocsIndex(path: string, language: string): Promise<DocIndexResponse> {
  return request<DocIndexResponse>(
    `/api/docs?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetDoc(path: string, language: string, id: string): Promise<DocResponse> {
  return request<DocResponse>(
    `/api/doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetImpact(
  path: string,
  language: string,
  id: string,
  maxDepth?: number,
): Promise<ImpactResponse> {
  const params = new URLSearchParams({ path, id, language })
  if (maxDepth !== undefined) params.set('max_depth', String(maxDepth))
  return request<ImpactResponse>(`/api/impact?${params.toString()}`)
}

function realSaveDoc(
  path: string,
  language: string,
  id: string,
  markdown: string,
): Promise<DocResponse> {
  return request<DocResponse>(
    `/api/doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}`,
    { method: 'POST', body: JSON.stringify({ markdown }) },
  )
}

function realGetComplexity(path: string, language: string): Promise<ComplexityResponse> {
  return request<ComplexityResponse>(
    `/api/complexity?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetComplexityDiff(path: string, language: string): Promise<ComplexityDiffResponse> {
  return request<ComplexityDiffResponse>(
    `/api/complexity/diff?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetGitRefs(path: string): Promise<GitRefsResponse> {
  return request<GitRefsResponse>(`/api/git/refs?path=${encodeURIComponent(path)}`)
}

function realGetComplexityDiffRef(
  path: string,
  language: string,
  ref: string,
  toRef?: string,
): Promise<ComplexityRefDiffResponse> {
  const params = new URLSearchParams({ path, ref, language })
  if (toRef) params.set('to_ref', toRef)
  return request<ComplexityRefDiffResponse>(`/api/complexity/diff-ref?${params.toString()}`)
}

function realGetComplexityHotspots(
  path: string,
  language: string,
  windowDays?: number,
): Promise<HotspotsResponse> {
  const params = new URLSearchParams({ path, language })
  if (windowDays !== undefined) params.set('window_days', String(windowDays))
  return request<HotspotsResponse>(`/api/complexity/hotspots?${params.toString()}`)
}

function realGetDeadCode(path: string, language: string): Promise<DeadCodeResponse> {
  return request<DeadCodeResponse>(
    `/api/dead-code?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realIngestCoverage(
  path: string,
  language: string,
  coveragePath: string,
): Promise<CoverageIngestResponse> {
  return request<CoverageIngestResponse>(
    `/api/coverage/ingest?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    { method: 'POST', body: JSON.stringify({ path: coveragePath }) },
  )
}

function realGetCoverageRisk(path: string, language: string): Promise<CoverageResponse> {
  return request<CoverageResponse>(
    `/api/coverage/risk?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetDuplicates(path: string, language: string): Promise<DuplicatesResponse> {
  return request<DuplicatesResponse>(
    `/api/duplicates?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetDependencyRisk(path: string, language: string): Promise<DependencyRiskResponse> {
  // `confirm_network_access: true` is only ever sent here -- this
  // function is only ever called from an explicit, user-triggered "Scan
  // dependencies" click (see `CodeHealthSidebar.tsx`'s `DependenciesPane`),
  // never automatically. The backend still enforces this server-side too
  // (a 400 if the flag isn't `true`), regardless of what this client sends.
  return request<DependencyRiskResponse>(
    `/api/dependencies/risk?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    { method: 'POST', body: JSON.stringify({ confirm_network_access: true }) },
  )
}

function realGetFlowchart(path: string, language: string, id: string): Promise<FlowchartResponse> {
  return request<FlowchartResponse>(
    `/api/flowchart?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}`,
  )
}

function realGetOllamaModels(): Promise<OllamaModelsResponse> {
  return request<OllamaModelsResponse>('/api/ollama-models')
}

function realDetectLanguages(path: string): Promise<{ detected: string[]; supported: string[] }> {
  return request<{ detected: string[]; supported: string[] }>('/api/detect-languages', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

function realIngestDbtManifest(
  path: string,
  language: string,
  manifestPath: string,
): Promise<DbtManifestIngestResponse> {
  return request<DbtManifestIngestResponse>(
    `/api/dataflow/dbt-manifest?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    { method: 'POST', body: JSON.stringify({ path: manifestPath }) },
  )
}

function realIngestDbConnection(
  path: string,
  language: string,
  connectionString: string,
): Promise<DbConnectionIngestResponse> {
  return request<DbConnectionIngestResponse>(
    `/api/dataflow/db-connection?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    { method: 'POST', body: JSON.stringify({ connection_string: connectionString }) },
  )
}

async function* realStreamDoc(
  path: string,
  language: string,
  id: string,
  provider: DocProvider,
  model: string | undefined,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/generate-doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model }),
      signal,
    },
  )

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const detail =
      body && typeof body === 'object' && 'detail' in body ? String(body.detail) : undefined
    throw new ApiError(response.status, detail ?? response.statusText)
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    yield decoder.decode(value, { stream: true })
  }
}

async function* realStreamCodeHealthRecommendations(
  path: string,
  language: string,
  provider: DocProvider,
  model: string | undefined,
  dependencyRisks: DependencyRisk[] | undefined,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/code-health/recommendations?path=${encodeURIComponent(path)}&language=${encodeURIComponent(language)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, dependency_risks: dependencyRisks ?? null }),
      signal,
    },
  )

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const detail =
      body && typeof body === 'object' && 'detail' in body ? String(body.detail) : undefined
    throw new ApiError(response.status, detail ?? response.statusText)
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    yield decoder.decode(value, { stream: true })
  }
}

export const parseRepo = DEMO_MODE ? demoClient.parseRepo : realParseRepo
export const updateDocRoot = DEMO_MODE ? demoClient.updateDocRoot : realUpdateDocRoot
export const getGraph = DEMO_MODE ? demoClient.getGraph : realGetGraph
export const getFunctionSource = DEMO_MODE ? demoClient.getFunctionSource : realGetFunctionSource
export const getGraphState = DEMO_MODE ? demoClient.getGraphState : realGetGraphState
export const saveGraphState = DEMO_MODE ? demoClient.saveGraphState : realSaveGraphState
export const getDocsIndex = DEMO_MODE ? demoClient.getDocsIndex : realGetDocsIndex
export const getDoc = DEMO_MODE ? demoClient.getDoc : realGetDoc
export const getImpact = DEMO_MODE ? demoClient.getImpact : realGetImpact
export const saveDoc = DEMO_MODE ? demoClient.saveDoc : realSaveDoc
export const getComplexity = DEMO_MODE ? demoClient.getComplexity : realGetComplexity
/** Demo-only: the static demo has no real filesystem to edit, so a
 * "compare to last look" can never have anything to report -- always
 * "no baseline," the same shape a fresh, never-viewed real repo's
 * `available: false` response does on the real backend (`current` still
 * populated with the live scores, not empty -- `handleCompareDashboard`
 * unconditionally replaces the dashboard's ranked list with `current`, so
 * returning `[]` here would silently blank it out on every demo compare). */
export const getComplexityDiff = DEMO_MODE
  ? async (path: string, language: string): Promise<ComplexityDiffResponse> => {
      const { scores } = await demoClient.getComplexity(path, language)
      return { available: false, current: scores, added: [], removed: [], changed: [] }
    }
  : realGetComplexityDiff
/** Demo-only: the static public demo has no real git history to diff
 * against -- always report `is_git_repo: false` so the ref-picker UI
 * hides itself entirely, the same "never attempt a call the demo backend
 * can't meaningfully answer" precedent as every other demo stub here. */
export const getGitRefs = DEMO_MODE
  ? async (): Promise<GitRefsResponse> => ({ is_git_repo: false, branches: [], commits: [] })
  : realGetGitRefs
/** Demo-only: unreachable in practice since the ref-picker never renders
 * when `getGitRefs` reports `is_git_repo: false` -- throwing here (rather
 * than fabricating a fake diff) matches how this file treats every other
 * demo-unreachable call. */
export const getComplexityDiffRef = DEMO_MODE
  ? async (
      _path: string,
      _language: string,
      _ref: string,
      _toRef?: string,
    ): Promise<ComplexityRefDiffResponse> => {
      throw new Error('Git ref comparison is not available in demo mode')
    }
  : realGetComplexityDiffRef
/** Demo-only: the static public demo has no real git history, so there's
 * nothing to compute churn against -- reports `is_git_repo: false` (like
 * `getGitRefs`) so the Hotspots tab renders its own "not available in
 * demo" state rather than throwing, since unlike the ref-picker (a small
 * inline control that can just not render) a whole tab staying clickable
 * but broken would be a worse demo experience than a tab that explains
 * itself. */
export const getComplexityHotspots = DEMO_MODE
  ? async (_path: string, _language: string, windowDays?: number): Promise<HotspotsResponse> => ({
      is_git_repo: false,
      scores: [],
      window_days: windowDays ?? 90,
    })
  : realGetComplexityHotspots
/** Demo-only: computing this for real needs the live backend's parsed
 * node data (the `has_decorators`/reverse-caller-index analysis in
 * `analysis/dead_code.py`), which the static demo's pre-generated fixture
 * bundle doesn't carry. Throws `DeadCodeUnavailableError` (not a plain
 * error, and not a silently-empty candidate list either) so the Dead Code
 * tab can render its own graceful "not available in demo" state -- the
 * same "a whole tab staying clickable but broken is worse than one that
 * explains itself" reasoning `getComplexityHotspots`'s stub above already
 * follows, just without a `DeadCodeResponse` field to carry the signal
 * (there's no real-world "unavailable" case for this route the way
 * `is_git_repo` is a real one for hotspots, so this stays a demo-only
 * concept rather than a schema addition). */
export const getDeadCode = DEMO_MODE
  ? async (_path: string, _language: string): Promise<DeadCodeResponse> => {
      throw new DeadCodeUnavailableError('Dead-code detection is not available in demo mode')
    }
  : realGetDeadCode
export const ingestCoverage = DEMO_MODE
  ? async (
      _path: string,
      _language: string,
      _coveragePath: string,
    ): Promise<CoverageIngestResponse> => {
      throw new CoverageUnavailableError('Coverage ingestion is not available in demo mode')
    }
  : realIngestCoverage
export const getCoverageRisk = DEMO_MODE
  ? async (_path: string, _language: string): Promise<CoverageResponse> => {
      throw new CoverageUnavailableError('Coverage ranking is not available in demo mode')
    }
  : realGetCoverageRisk
// Demo-only: fully local/offline analysis (no ingested file, no git/network
// dependency), so unlike `getDeadCode`/`getCoverageRisk` this can safely
// return a real, valid empty response rather than throwing -- the demo's
// fixture bundle just never happens to contain any duplicate functions.
export const getDuplicates = DEMO_MODE
  ? async (_path: string, _language: string): Promise<DuplicatesResponse> => ({ groups: [] })
  : realGetDuplicates
export const getDependencyRisk = DEMO_MODE
  ? async (_path: string, _language: string): Promise<DependencyRiskResponse> => {
      throw new DependencyRiskUnavailableError(
        'Dependency risk scanning is not available in demo mode',
      )
    }
  : realGetDependencyRisk
export const getFlowchart = DEMO_MODE ? demoClient.getFlowchart : realGetFlowchart
export const getOllamaModels = DEMO_MODE ? demoClient.getOllamaModels : realGetOllamaModels
export const ingestDbtManifest = DEMO_MODE ? demoClient.ingestDbtManifest : realIngestDbtManifest
export const ingestDbConnection = DEMO_MODE ? demoClient.ingestDbConnection : realIngestDbConnection
export const streamDoc = DEMO_MODE ? demoClient.streamDoc : realStreamDoc
// Not a generator function -- it always throws before there's ever
// anything to yield, and a generator with no `yield` at all is a lint
// smell (`require-yield`) precisely because it usually signals a mistake
// like this one. A plain function that throws synchronously still fails
// a `for await (... of streamCodeHealthRecommendations(...))` at the same
// point (the iterable expression is evaluated eagerly), so callers don't
// need to know the difference.
export const streamCodeHealthRecommendations = DEMO_MODE
  ? (..._args: unknown[]): AsyncGenerator<string> => {
      throw new RecommendationsUnavailableError(
        'AI recommendations are not available in demo mode',
      )
    }
  : realStreamCodeHealthRecommendations
export const detectLanguages = realDetectLanguages
/** Demo-only: no real-backend concept of an impact-analysis "showcase"
 * function exists, so the real app always gets an empty list rather than
 * a second code path every consumer has to branch on. */
export const getImpactShowcaseIds = DEMO_MODE ? demoClient.getImpactShowcaseIds : async () => []
/** Demo-only: a real repo always uses the generic root-id/threshold
 * logic in `App.tsx`'s `handleLoad`, so the real app always gets `null`
 * (meaning "no curated override, fall back to the generic behavior"). */
export const getDefaultVisibleIds = DEMO_MODE ? demoClient.getDefaultVisibleIds : async () => null
