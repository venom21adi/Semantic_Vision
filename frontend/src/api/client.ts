import type {
  ComplexityResponse,
  DbConnectionIngestResponse,
  DbtManifestIngestResponse,
  DocIndexResponse,
  DocProvider,
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

function realUpdateDocRoot(path: string, docRoot: string): Promise<DocRootResponse> {
  return request<DocRootResponse>(`/api/doc-root?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ doc_root: docRoot }),
  })
}

function realGetGraph(path: string): Promise<GraphResponse> {
  return request<GraphResponse>(`/api/graph?path=${encodeURIComponent(path)}`)
}

function realGetFunctionSource(path: string, id: string): Promise<FunctionSourceResponse> {
  return request<FunctionSourceResponse>(
    `/api/function-source?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
  )
}

function realGetGraphState(path: string): Promise<GraphStateResponse> {
  return request<GraphStateResponse>(`/api/graph-state?path=${encodeURIComponent(path)}`)
}

function realSaveGraphState(
  path: string,
  positions: Record<string, NodePosition>,
): Promise<GraphStateResponse> {
  return request<GraphStateResponse>(`/api/graph-state?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ positions }),
  })
}

function realGetDocsIndex(path: string): Promise<DocIndexResponse> {
  return request<DocIndexResponse>(`/api/docs?path=${encodeURIComponent(path)}`)
}

function realGetDoc(path: string, id: string): Promise<DocResponse> {
  return request<DocResponse>(
    `/api/doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
  )
}

function realGetImpact(path: string, id: string, maxDepth?: number): Promise<ImpactResponse> {
  const params = new URLSearchParams({ path, id })
  if (maxDepth !== undefined) params.set('max_depth', String(maxDepth))
  return request<ImpactResponse>(`/api/impact?${params.toString()}`)
}

function realSaveDoc(path: string, id: string, markdown: string): Promise<DocResponse> {
  return request<DocResponse>(
    `/api/doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify({ markdown }) },
  )
}

function realGetComplexity(path: string): Promise<ComplexityResponse> {
  return request<ComplexityResponse>(`/api/complexity?path=${encodeURIComponent(path)}`)
}

function realGetFlowchart(path: string, id: string): Promise<FlowchartResponse> {
  return request<FlowchartResponse>(
    `/api/flowchart?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
  )
}

function realGetOllamaModels(): Promise<OllamaModelsResponse> {
  return request<OllamaModelsResponse>('/api/ollama-models')
}

function realIngestDbtManifest(
  path: string,
  manifestPath: string,
): Promise<DbtManifestIngestResponse> {
  return request<DbtManifestIngestResponse>(
    `/api/dataflow/dbt-manifest?path=${encodeURIComponent(path)}`,
    { method: 'POST', body: JSON.stringify({ path: manifestPath }) },
  )
}

function realIngestDbConnection(
  path: string,
  connectionString: string,
): Promise<DbConnectionIngestResponse> {
  return request<DbConnectionIngestResponse>(
    `/api/dataflow/db-connection?path=${encodeURIComponent(path)}`,
    { method: 'POST', body: JSON.stringify({ connection_string: connectionString }) },
  )
}

async function* realStreamDoc(
  path: string,
  id: string,
  provider: DocProvider,
  model: string | undefined,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/generate-doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
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
export const getFlowchart = DEMO_MODE ? demoClient.getFlowchart : realGetFlowchart
export const getOllamaModels = DEMO_MODE ? demoClient.getOllamaModels : realGetOllamaModels
export const ingestDbtManifest = DEMO_MODE ? demoClient.ingestDbtManifest : realIngestDbtManifest
export const ingestDbConnection = DEMO_MODE ? demoClient.ingestDbConnection : realIngestDbConnection
export const streamDoc = DEMO_MODE ? demoClient.streamDoc : realStreamDoc
/** Demo-only: no real-backend concept of a "showcase" function exists, so
 * the real app always gets an empty list rather than a second code path
 * every consumer has to branch on. */
export const getShowcaseFunctionIds = DEMO_MODE ? demoClient.getShowcaseFunctionIds : async () => []
