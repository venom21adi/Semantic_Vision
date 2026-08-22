import type {
  DocIndexResponse,
  DocProvider,
  DocResponse,
  DocRootResponse,
  FunctionSourceResponse,
  GraphResponse,
  GraphStateResponse,
  ImpactResponse,
  NodePosition,
  OllamaModelsResponse,
  ParseRepoResponse,
} from './types'

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

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

export function parseRepo(path: string, docRoot?: string): Promise<ParseRepoResponse> {
  return request<ParseRepoResponse>('/api/parse-repo', {
    method: 'POST',
    body: JSON.stringify({ path, doc_root: docRoot || undefined }),
  })
}

export function updateDocRoot(path: string, docRoot: string): Promise<DocRootResponse> {
  return request<DocRootResponse>(`/api/doc-root?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ doc_root: docRoot }),
  })
}

export function getGraph(path: string): Promise<GraphResponse> {
  return request<GraphResponse>(`/api/graph?path=${encodeURIComponent(path)}`)
}

export function getFunctionSource(path: string, id: string): Promise<FunctionSourceResponse> {
  return request<FunctionSourceResponse>(
    `/api/function-source?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
  )
}

export function getGraphState(path: string): Promise<GraphStateResponse> {
  return request<GraphStateResponse>(`/api/graph-state?path=${encodeURIComponent(path)}`)
}

export function saveGraphState(
  path: string,
  positions: Record<string, NodePosition>,
): Promise<GraphStateResponse> {
  return request<GraphStateResponse>(`/api/graph-state?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ positions }),
  })
}

export function getDocsIndex(path: string): Promise<DocIndexResponse> {
  return request<DocIndexResponse>(`/api/docs?path=${encodeURIComponent(path)}`)
}

export function getDoc(path: string, id: string): Promise<DocResponse> {
  return request<DocResponse>(
    `/api/doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
  )
}

export function getImpact(path: string, id: string, maxDepth?: number): Promise<ImpactResponse> {
  const params = new URLSearchParams({ path, id })
  if (maxDepth !== undefined) params.set('max_depth', String(maxDepth))
  return request<ImpactResponse>(`/api/impact?${params.toString()}`)
}

export function saveDoc(path: string, id: string, markdown: string): Promise<DocResponse> {
  return request<DocResponse>(
    `/api/doc?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify({ markdown }) },
  )
}

export function getOllamaModels(): Promise<OllamaModelsResponse> {
  return request<OllamaModelsResponse>('/api/ollama-models')
}

export async function* streamDoc(
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
