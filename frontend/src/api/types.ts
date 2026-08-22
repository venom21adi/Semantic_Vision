export type NodeKind = 'directory' | 'file' | 'class' | 'function'
export type EdgeKind = 'calls' | 'imports' | 'defines'

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  file: string
  line_start: number
  line_end: number
}

export interface GraphEdge {
  source: string
  target: string
  kind: EdgeKind
  external: boolean
  ambiguous: boolean
}

export interface ParseErrorInfo {
  file: string
  line: number | null
  message: string
}

export interface ParseRepoResponse {
  path: string
  node_count: number
  edge_count: number
  parse_errors: ParseErrorInfo[]
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface FunctionSourceResponse {
  id: string
  file: string
  line_start: number
  line_end: number
  source: string
}

export interface NodePosition {
  x: number
  y: number
}

export interface GraphStateResponse {
  positions: Record<string, NodePosition>
  updated_at: string | null
}

export interface DocIndexEntry {
  node_id: string
  hash: string
  updated_at: string
}

export interface DocIndexResponse {
  entries: DocIndexEntry[]
}

export interface DocResponse {
  node_id: string
  markdown: string
  updated_at: string
}

export interface Caller {
  id: string
  depth: number
  direct: boolean
}

export interface ImpactResponse {
  target: string
  callers: Caller[]
  edges: GraphEdge[]
  cycles: string[][]
}

export type DocProvider = 'ollama' | 'openai' | 'anthropic'

export interface OllamaModelsResponse {
  models: string[]
}
