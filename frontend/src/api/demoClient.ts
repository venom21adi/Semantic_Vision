/**
 * Static, backend-free implementation of every function `client.ts`
 * exports, for the static demo build (`VITE_DEMO_MODE=true`). Serves
 * precomputed fixtures (`frontend/demo-assets/<slug>/*.json`, produced by
 * `scripts/build_demo_fixtures.py` and `scripts/generate_demo_docs.py`,
 * copied into `dist/demo/` at build time by `scripts/copy-demo-assets.mjs`)
 * instead of calling a live backend.
 *
 * `path` throughout this module is one of `DEMO_SLUGS` (the repo picker
 * chooses it), not a filesystem path.
 */

import { ApiError } from './client'
import type {
  ComplexityResponse,
  DbConnectionIngestResponse,
  DbtManifestIngestResponse,
  DocIndexResponse,
  DocResponse,
  DocRootResponse,
  FlowchartResponse,
  FunctionSourceResponse,
  GraphResponse,
  GraphStateResponse,
  ImpactResponse,
  NodePosition,
  OllamaModelsResponse,
  ParseRepoResponse,
} from './types'

export interface DemoRepoMeta {
  slug: string
  displayName: string
  language: string
  description: string
  nodeCount: number
  edgeCount: number
  hasDataLineage: boolean
  showcaseDocIds: string[]
  /** Curated root node ids to show on first load instead of every root
   * (see `getDefaultVisibleIds`) -- absent/empty for a repo whose real
   * directory structure already collapses to a handful of top-level
   * items on its own. */
  defaultVisibleIds?: string[]
}

export const DEMO_SLUGS = ['python-shop', 'axios', 'guava-base'] as const
export type DemoSlug = (typeof DEMO_SLUGS)[number]

export function isDemoSlug(path: string): path is DemoSlug {
  return (DEMO_SLUGS as readonly string[]).includes(path)
}

interface DemoBundle {
  meta: DemoRepoMeta
  graphPre: GraphResponse
  graphPost: GraphResponse | null
  complexity: ComplexityResponse
  impact: Record<string, ImpactResponse>
  flowchart: Record<string, FlowchartResponse>
  functionSource: Record<string, FunctionSourceResponse>
  docs: Record<string, string>
  dbtIngest: DbtManifestIngestResponse | null
}

const DEMO_BASE = `${import.meta.env.BASE_URL}demo`

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new ApiError(response.status, `Failed to load demo fixture: ${url}`)
  }
  return response.json() as Promise<T>
}

const metaCache = new Map<string, Promise<DemoRepoMeta>>()

function loadMeta(slug: string): Promise<DemoRepoMeta> {
  let promise = metaCache.get(slug)
  if (!promise) {
    promise = fetchJson<DemoRepoMeta>(`${DEMO_BASE}/${slug}/meta.json`)
    metaCache.set(slug, promise)
  }
  return promise
}

export function loadDemoRepoList(): Promise<DemoRepoMeta[]> {
  return Promise.all(DEMO_SLUGS.map((slug) => loadMeta(slug)))
}

/** A demo repo's curated first-load selection, if it has one -- see
 * `meta.json`'s `defaultVisibleIds`. `App.tsx`'s `handleLoad` falls back
 * to its own generic root-id computation when this is `null` (every
 * non-demo repo, and any demo repo without a curated override). Exists
 * specifically for a repo whose own top level doesn't collapse into a
 * manageable handful of items on its own (e.g. a flat directory of many
 * files with no subfolders) -- picking every root id there would dump
 * all of them onto the canvas at once, a much busier first impression
 * than the other demos give for free from their own directory shape. */
export async function getDefaultVisibleIds(path: string): Promise<string[] | null> {
  if (!isDemoSlug(path)) return null
  const meta = await loadMeta(path)
  return meta.defaultVisibleIds?.length ? meta.defaultVisibleIds : null
}

const MAX_IMPACT_SHOWCASE_IDS = 6

/** Functions worth suggesting to a first-time visitor for Impact Analysis
 * specifically -- guaranteed to have at least one real caller, so "click
 * one of these" can't itself land on the "No callers found" dead end it
 * exists to avoid. Prefers the functions already curated for AI-doc
 * generation (real branching, worth looking at) when they qualify, but
 * doesn't assume they always do: `meta.json`'s `showcaseDocIds` was picked
 * for doc-generation quality alone, and for axios specifically, 5 of its
 * 6 picks genuinely have zero callers in this trimmed-subset repo
 * (confirmed live) -- likely called from real axios source that didn't
 * make the cut into this demo's smaller file set. Tops up from every
 * other function with real callers, ranked by caller count, whenever a
 * repo's own showcase picks don't supply enough on their own.
 *
 * `App.tsx` uses this to populate the empty details panel's suggestions.
 * Reuses `loadBundle`'s cache -- by the time App.tsx calls this (after
 * `parseRepo`, which already awaits `loadBundle`), the impact data is
 * already in memory, so this never costs a second fetch. */
export async function getImpactShowcaseIds(path: string): Promise<string[]> {
  if (!isDemoSlug(path)) return []
  const bundle = await loadBundle(path)

  const hasCallers = (id: string) => (bundle.impact[id]?.callers.length ?? 0) > 0
  const fromDocShowcase = bundle.meta.showcaseDocIds.filter(hasCallers)

  const rankedByCallerCount = Object.entries(bundle.impact)
    .filter(([id, result]) => result.callers.length > 0 && !fromDocShowcase.includes(id))
    .sort(([, a], [, b]) => b.callers.length - a.callers.length)
    .map(([id]) => id)

  return [...fromDocShowcase, ...rankedByCallerCount].slice(0, MAX_IMPACT_SHOWCASE_IDS)
}

const bundleCache = new Map<string, Promise<DemoBundle>>()

async function fetchBundle(slug: string): Promise<DemoBundle> {
  const base = `${DEMO_BASE}/${slug}`
  const meta = await loadMeta(slug)

  const [complexity, impact, flowchart, functionSource, docs] = await Promise.all([
    fetchJson<ComplexityResponse>(`${base}/complexity.json`),
    fetchJson<Record<string, ImpactResponse>>(`${base}/impact.json`),
    fetchJson<Record<string, FlowchartResponse>>(`${base}/flowchart.json`),
    fetchJson<Record<string, FunctionSourceResponse>>(`${base}/function-source.json`),
    fetchJson<Record<string, string>>(`${base}/docs.json`).catch(() => ({})),
  ])

  let graphPre: GraphResponse
  let graphPost: GraphResponse | null = null
  let dbtIngest: DbtManifestIngestResponse | null = null

  if (meta.hasDataLineage) {
    ;[graphPre, graphPost, dbtIngest] = await Promise.all([
      fetchJson<GraphResponse>(`${base}/graph-pre-dbt.json`),
      fetchJson<GraphResponse>(`${base}/graph-post-dbt.json`),
      fetchJson<DbtManifestIngestResponse>(`${base}/dbt-ingest.json`),
    ])
  } else {
    graphPre = await fetchJson<GraphResponse>(`${base}/graph.json`)
  }

  return { meta, graphPre, graphPost, complexity, impact, flowchart, functionSource, docs, dbtIngest }
}

function loadBundle(slug: string): Promise<DemoBundle> {
  let promise = bundleCache.get(slug)
  if (!promise) {
    promise = fetchBundle(slug)
    bundleCache.set(slug, promise)
  }
  return promise
}

/** Slugs where the sample dbt manifest has been "ingested" this session --
 * flips `getGraph` over to the post-ingest fixture, mirroring the real
 * backend's cached-graph mutation without a server. */
const dbtIngestedSlugs = new Set<string>()

function localStorageKey(slug: string, suffix: string): string {
  return `sv-demo:${slug}:${suffix}`
}

function readLocalJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLocalJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Best-effort: private browsing / storage quota. The demo still works,
    // it just won't remember this across a reload.
  }
}

export async function parseRepo(
  path: string,
  _docRoot?: string,
  _language?: string,
): Promise<ParseRepoResponse> {
  const bundle = await loadBundle(path)
  dbtIngestedSlugs.delete(path)
  return {
    path,
    doc_root: `demo:${path}`,
    node_count: bundle.meta.nodeCount,
    edge_count: bundle.meta.edgeCount,
    parse_errors: [],
  }
}

export function updateDocRoot(
  _path: string,
  _language: string,
  docRoot: string,
): Promise<DocRootResponse> {
  return Promise.resolve({ doc_root: docRoot })
}

export async function getGraph(path: string, _language: string): Promise<GraphResponse> {
  const bundle = await loadBundle(path)
  if (dbtIngestedSlugs.has(path) && bundle.graphPost) return bundle.graphPost
  return bundle.graphPre
}

export async function getFunctionSource(
  path: string,
  _language: string,
  id: string,
): Promise<FunctionSourceResponse> {
  const bundle = await loadBundle(path)
  const found = bundle.functionSource[id]
  if (!found) throw new ApiError(404, `No source found for: ${id}`)
  return found
}

export async function getImpact(
  path: string,
  _language: string,
  id: string,
  _maxDepth?: number,
): Promise<ImpactResponse> {
  const bundle = await loadBundle(path)
  const found = bundle.impact[id]
  if (!found) throw new ApiError(404, `No impact data for: ${id}`)
  return found
}

export function getGraphState(path: string, _language: string): Promise<GraphStateResponse> {
  const saved = readLocalJson<GraphStateResponse>(localStorageKey(path, 'graph-state'))
  return Promise.resolve(saved ?? { positions: {}, updated_at: null })
}

export function saveGraphState(
  path: string,
  _language: string,
  positions: Record<string, NodePosition>,
): Promise<GraphStateResponse> {
  const result: GraphStateResponse = { positions, updated_at: new Date().toISOString() }
  writeLocalJson(localStorageKey(path, 'graph-state'), result)
  return Promise.resolve(result)
}

export function getDocsIndex(path: string, _language: string): Promise<DocIndexResponse> {
  const prefix = localStorageKey(path, 'doc:')
  const entries: DocIndexResponse['entries'] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix)) continue
    const saved = readLocalJson<DocResponse>(key)
    if (saved) entries.push({ node_id: saved.node_id, hash: 'demo', updated_at: saved.updated_at })
  }
  return Promise.resolve({ entries })
}

export function getDoc(path: string, _language: string, id: string): Promise<DocResponse> {
  const saved = readLocalJson<DocResponse>(localStorageKey(path, `doc:${id}`))
  if (!saved) return Promise.reject(new ApiError(404, `No saved documentation for: ${id}`))
  return Promise.resolve(saved)
}

export function saveDoc(
  path: string,
  _language: string,
  id: string,
  markdown: string,
): Promise<DocResponse> {
  const result: DocResponse = { node_id: id, markdown, updated_at: new Date().toISOString() }
  writeLocalJson(localStorageKey(path, `doc:${id}`), result)
  return Promise.resolve(result)
}

export async function getComplexity(path: string, _language: string): Promise<ComplexityResponse> {
  const bundle = await loadBundle(path)
  return bundle.complexity
}

export async function getFlowchart(
  path: string,
  _language: string,
  id: string,
): Promise<FlowchartResponse> {
  const bundle = await loadBundle(path)
  const found = bundle.flowchart[id]
  if (!found) throw new ApiError(404, `No flowchart available for: ${id}`)
  return found
}

export function getOllamaModels(): Promise<OllamaModelsResponse> {
  return Promise.resolve({ models: ['qwen2.5-coder:3b', 'llama3.2:3b'] })
}

export async function ingestDbtManifest(
  path: string,
  _language: string,
  _manifestPath: string,
): Promise<DbtManifestIngestResponse> {
  const bundle = await loadBundle(path)
  if (!bundle.meta.hasDataLineage || !bundle.dbtIngest) {
    throw new ApiError(
      400,
      "This demo's data lineage example lives in the Python repo — switch repos to try it.",
    )
  }
  dbtIngestedSlugs.add(path)
  return bundle.dbtIngest
}

export function ingestDbConnection(
  _path: string,
  _language: string,
  _connectionString: string,
): Promise<DbConnectionIngestResponse> {
  return Promise.reject(
    new ApiError(
      400,
      "Live database connections aren't available in this static demo — see the recording above.",
    ),
  )
}

const DOC_CHUNK_SIZE = 24
const DOC_CHUNK_DELAY_MS = 20

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function* streamDoc(
  path: string,
  _language: string,
  id: string,
  _provider: string,
  _model: string | undefined,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const bundle = await loadBundle(path)
  const markdown = bundle.docs[id]
  if (!markdown) {
    throw new ApiError(
      404,
      'AI documentation is precomputed for a handful of functions in this demo — try one of the highlighted functions, or watch the recording above.',
    )
  }

  for (let i = 0; i < markdown.length; i += DOC_CHUNK_SIZE) {
    if (signal?.aborted) return
    await delay(DOC_CHUNK_DELAY_MS)
    if (signal?.aborted) return
    yield markdown.slice(i, i + DOC_CHUNK_SIZE)
  }
}
