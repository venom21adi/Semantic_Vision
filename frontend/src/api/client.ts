import type { FunctionSourceResponse, GraphResponse, ParseRepoResponse } from './types'

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

export function parseRepo(path: string): Promise<ParseRepoResponse> {
  return request<ParseRepoResponse>('/api/parse-repo', {
    method: 'POST',
    body: JSON.stringify({ path }),
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
