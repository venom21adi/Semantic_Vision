export interface LayoutRequest {
  jobId: number
  direction: 'TB' | 'LR'
  nodeIds: string[]
  edges: { source: string; target: string }[]
}

export interface LayoutResponse {
  jobId: number
  positions: { id: string; x: number; y: number }[]
}
