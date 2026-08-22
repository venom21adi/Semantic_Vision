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
