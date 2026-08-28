export type NodeKind = 'directory' | 'file' | 'class' | 'function' | 'table' | 'dbt_model'
export type EdgeKind =
  | 'calls'
  | 'imports'
  | 'defines'
  | 'maps_to'
  | 'foreign_key'
  | 'references'
  | 'materializes'
  | 'reads'
  | 'writes'

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  file: string
  line_start: number
  line_end: number
  /** Provenance tag for a `table` node -- `"orm_model"`, `"dbt"`, or
   * `"live_db"` depending on which data-source ingest created it.
   * `null`/absent for every other node kind. */
  source?: string | null
  /** JS/TS getter/setter marker, set only on a FUNCTION node produced
   * from one. `label` stays the bare method name regardless -- use
   * `formatNodeLabel` (graph/accessorLabel.ts) wherever this needs to be
   * shown to a person, rather than reading this field directly. */
  accessor_kind?: 'get' | 'set' | null
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
  doc_root: string
  node_count: number
  edge_count: number
  parse_errors: ParseErrorInfo[]
}

export interface DocRootResponse {
  doc_root: string
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

export type FlowNodeKind = 'entry' | 'return' | 'statement' | 'call' | 'decision' | 'loop' | 'io'
export type FlowEdgeKind = 'flow' | 'true' | 'false' | 'loop_back'

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  label: string
  line: number
  end_line: number
}

export interface FlowEdge {
  source: string
  target: string
  kind: FlowEdgeKind
  label: string | null
}

export interface FlowchartResponse {
  target: string
  entry: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface ComplexityScore {
  node_id: string
  cyclomatic_complexity: number
  call_chain_depth: number
  has_nested_loops: boolean
}

export interface ComplexityResponse {
  scores: ComplexityScore[]
}

export interface DbtManifestIngestResponse {
  models_ingested: number
  tables_reconciled: number
  tables_created: number
}

export interface DbConnectionIngestResponse {
  tables_ingested: number
  tables_reconciled: number
  tables_created: number
}
