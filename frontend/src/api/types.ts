export type NodeKind = 'directory' | 'file' | 'class' | 'function' | 'table' | 'dbt_model' | 'column'
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

export interface ComplexityChange {
  node_id: string
  before: ComplexityScore
  after: ComplexityScore
}

export interface ComplexityDiffResponse {
  available: boolean
  current: ComplexityScore[]
  added: ComplexityScore[]
  removed: ComplexityScore[]
  changed: ComplexityChange[]
}

export interface GitCommitInfo {
  sha: string
  subject: string
}

export interface GitRefsResponse {
  is_git_repo: boolean
  branches: string[]
  commits: GitCommitInfo[]
}

export interface ComplexityRefDiffResponse {
  ref: string
  to_ref: string | null
  available: boolean
  current: ComplexityScore[]
  added: ComplexityScore[]
  removed: ComplexityScore[]
  changed: ComplexityChange[]
}

export interface HotspotScore {
  node_id: string
  cyclomatic_complexity: number
  change_count: number
  hotspot_score: number
}

export interface HotspotsResponse {
  is_git_repo: boolean
  scores: HotspotScore[]
  window_days: number
}

export interface DeadCodeCandidate {
  node_id: string
}

export interface DeadCodeResponse {
  candidates: DeadCodeCandidate[]
}

export interface CoverageRiskScore {
  node_id: string
  cyclomatic_complexity: number
  blast_radius: number
  coverage_ratio: number | null
  risk_score: number
}

export interface CoverageResponse {
  available: boolean
  scores: CoverageRiskScore[]
}

export interface CoverageIngestResponse {
  files_in_report: number
  /** Of `files_in_report`, how many actually correspond to a file in this
   * parsed repo. `0` alongside a non-zero `files_in_report` means the
   * report's paths don't line up with this repo's own -- every function's
   * `coverage_ratio` will read `null`, not a bug. */
  files_matched: number
  lines_recorded: number
}

export interface DuplicateGroup {
  node_ids: string[]
  size: number
}

export interface DuplicatesResponse {
  groups: DuplicateGroup[]
}

export interface VulnerabilitySummary {
  id: string
}

export interface DependencyRisk {
  package: string
  version: string | null
  ecosystem: string
  vulnerabilities: VulnerabilitySummary[]
}

export interface DependencyRiskResponse {
  available: boolean
  risks: DependencyRisk[]
  message: string | null
}

export interface DbtManifestIngestResponse {
  models_ingested: number
  tables_reconciled: number
  tables_created: number
  columns_reconciled: number
  columns_created: number
}

export interface DbConnectionIngestResponse {
  tables_ingested: number
  tables_reconciled: number
  tables_created: number
  columns_reconciled: number
  columns_created: number
}
