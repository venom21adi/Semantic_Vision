import { useMemo, type ReactNode } from 'react'
import type { ComplexityScore, DependencyRisk, GraphEdge, GraphNode } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { LARGE_GRAPH_NODE_THRESHOLD } from '../graph/GraphCanvas'
import { complexityToColor } from '../graph/heatmap'
import { MiniCallGraph } from '../graph/MiniCallGraph'
import { PackageImportersGraph } from '../graph/PackageImportersGraph'
import { colors, radius, spacing } from '../theme'
import { RecommendationsOutputPane } from './CodeHealthRecommendationsPane'
import type { DashboardState, DiffMode, DiffState, HealthTab, RecommendationsState } from './codeHealthTypes'
import { RankedFunctionRow } from './RankedFunctionRow'
import { RefPicker, type GitRefsState } from './RefPicker'
import { SummaryStatsHeader } from './SummaryStatsHeader'

const MAX_NEIGHBORHOOD_NODES = LARGE_GRAPH_NODE_THRESHOLD

const TAB_BLURB: Record<HealthTab, string> = {
  complexity: 'Cyclomatic complexity, ranked across every function.',
  hotspots: 'Complexity weighted by how often each file actually changes.',
  'dead-code': "Zero-caller functions -- candidates to review, never a verdict.",
  coverage: 'Complexity, blast radius, and test coverage combined into one risk score.',
  duplicates: 'Functions whose structure is identical after stripping names and literals.',
  dependencies: 'Known vulnerabilities in packages this repo actually imports (via osv.dev) -- select one to see which of your own files import it.',
  recommendations: 'AI-prioritized findings across complexity, hotspots, coverage, and duplicates.',
}

interface CodeHealthDetailProps {
  healthTab: HealthTab
  state: DashboardState
  diff: DiffState | null
  onCompare: () => void
  gitRefs: GitRefsState | null
  onCompareToRef: (ref: string, label: string, toRef?: string, toLabel?: string) => void
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  dependencyRisks: DependencyRisk[]
  selectedPackage: string | null
  recommendations: RecommendationsState
}

/** The Code Health lens's main-content column -- occupies exactly the
 * position the graph canvas + `DetailsPanel` do in the Codebase Graph lens
 * (see `App.tsx`'s lens switch). Complexity-specific controls (compare,
 * diff, summary stats) only render for the Complexity tab -- hotspots and
 * dead-code have no "diff against last look" concept -- but the call-depth
 * relationship graph for whatever function is selected is shared by all
 * three, since "who calls this" is a property of the function, not of
 * which tab you found it through. */
export function CodeHealthDetail({
  healthTab,
  state,
  diff,
  onCompare,
  gitRefs,
  onCompareToRef,
  graphNodes,
  graphEdges,
  selectedNodeId,
  onSelectNode,
  dependencyRisks,
  selectedPackage,
  recommendations,
}: CodeHealthDetailProps) {
  const compareDisabled = state.status !== 'loaded' || diff?.status === 'loading'
  const scores = state.status === 'loaded' ? state.scores : []
  const selectedRisk = selectedPackage
    ? dependencyRisks.find((risk) => risk.package === selectedPackage)
    : undefined

  // Resolves a raw dotted node id to its real name/file for the diff rows
  // below (`RankedFunctionRow`) and for the "Call relationships for ..."
  // caption -- same map-from-`graphNodes` pattern `CodeHealthSidebar`'s own
  // report panes use, so an id with no match falls back to itself instead
  // of throwing.
  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])
  const selectedNode = selectedNodeId ? graphNodeById.get(selectedNodeId) : undefined
  const selectedLabel = selectedNodeId
    ? selectedNode
      ? formatNodeLabel(selectedNode.label, selectedNode.accessor_kind)
      : selectedNodeId
    : null

  // Scopes the relationship diagram to the *selected* function's direct
  // callers/callees only -- never the whole repo's call graph. Feeding
  // `MiniCallGraph` (and the dagre layout inside it, `graph/layout.ts`)
  // every scored function at once hung the browser outright on a
  // real-world repo the size of FastAPI: a single `.filter()` over
  // `graphEdges` here is cheap even at thousands of edges, but laying out
  // thousands of nodes is not. `MAX_NEIGHBORHOOD_NODES` reuses
  // `GraphCanvas`'s own large-graph threshold rather than inventing a new
  // number, guarding the one remaining pathological case: a single hub
  // function called from hundreds of places.
  const selectedNeighborhood = useMemo(() => {
    if (!selectedNodeId) {
      return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], truncated: false, totalCount: 0 }
    }
    const neighborEdges = graphEdges.filter(
      (edge) =>
        edge.kind === 'calls' && (edge.source === selectedNodeId || edge.target === selectedNodeId),
    )
    const neighborIds = new Set<string>([selectedNodeId])
    for (const edge of neighborEdges) {
      neighborIds.add(edge.source)
      neighborIds.add(edge.target)
    }
    const totalCount = neighborIds.size
    const truncated = totalCount > MAX_NEIGHBORHOOD_NODES
    const idList = [
      selectedNodeId,
      ...[...neighborIds].filter((id) => id !== selectedNodeId),
    ].slice(0, MAX_NEIGHBORHOOD_NODES)
    const idSet = new Set(idList)
    return {
      nodes: graphNodes.filter((node) => idSet.has(node.id)),
      edges: neighborEdges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target)),
      truncated,
      totalCount,
    }
  }, [selectedNodeId, graphNodes, graphEdges])

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: `1px solid ${colors.bgPanel}`,
          background: colors.bgPage,
          color: colors.textPrimary,
          fontSize: 12,
          flexShrink: 0,
          gap: spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: colors.textMuted }}>{TAB_BLURB[healthTab]}</div>
        {healthTab === 'complexity' && (
          <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0, alignItems: 'center' }}>
            <RefPicker state={gitRefs} disabled={compareDisabled} onCompare={onCompareToRef} />
            <button
              onClick={onCompare}
              disabled={compareDisabled}
              className="sv-interactive"
              title="Re-parse the repo and compare its complexity against the last time this lens fetched it -- see what an edit changed"
              style={{
                background: colors.bgPanel,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                color: compareDisabled ? colors.textDim : colors.textPrimary,
                padding: '4px 10px',
                fontSize: 12,
                cursor: compareDisabled ? 'default' : 'pointer',
              }}
            >
              {diff?.status === 'loading' && diff.mode.kind === 'last-look' ? 'Comparing…' : 'Compare to last look'}
            </button>
          </div>
        )}
      </div>
      {healthTab === 'complexity' && state.status === 'loaded' && (
        <div style={{ padding: `${spacing.lg}px ${spacing.lg}px 0` }}>
          <SummaryStatsHeader scores={state.scores} />
          {diff && (
            <DiffPanel
              diff={diff}
              onSelectNode={onSelectNode}
              graphNodeById={graphNodeById}
              selectedNodeId={selectedNodeId}
            />
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {healthTab === 'recommendations' ? (
          <RecommendationsOutputPane state={recommendations} />
        ) : healthTab === 'dependencies' ? (
          selectedRisk ? (
            <PackageDetailAndImporters
              risk={selectedRisk}
              graphNodes={graphNodes}
              scores={scores}
            />
          ) : (
            <p style={{ color: colors.textMuted, fontSize: 12, padding: spacing.lg, margin: 0 }}>
              Select a package to see which of your own files import it.
            </p>
          )
        ) : selectedNodeId ? (
          <>
            {/* The selection (and this graph) persists across tab switches
             * -- "who calls this" doesn't change depending on which tab you
             * found the function through -- so this caption exists to make
             * that legible rather than reading as a stale leftover from
             * whatever tab was active before. */}
            <p
              style={{
                color: colors.textMuted,
                fontSize: 11,
                padding: `${spacing.sm}px ${spacing.md}px 0`,
                margin: 0,
              }}
            >
              Call relationships for <strong style={{ color: colors.textPrimary }}>{selectedLabel}</strong>
            </p>
            <MiniCallGraph
              nodes={selectedNeighborhood.nodes}
              edges={selectedNeighborhood.edges}
              scores={scores}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
            {selectedNeighborhood.truncated && (
              <p style={{ color: colors.textMuted, fontSize: 11, padding: '4px 8px', margin: 0 }}>
                Showing {MAX_NEIGHBORHOOD_NODES} of {selectedNeighborhood.totalCount} related functions.
              </p>
            )}
          </>
        ) : (
          <p style={{ color: colors.textMuted, fontSize: 12, padding: spacing.lg, margin: 0 }}>
            Select a function from the list to see its call relationships.
          </p>
        )}
      </div>
    </div>
  )
}

/** The dependencies-tab canvas -- a package-detail header (full,
 * uncapped vulnerability list, unlike the tile grid's own capped badges)
 * above `PackageImportersGraph`, occupying the exact spot `MiniCallGraph`
 * fills for every other tab. */
function PackageDetailAndImporters({
  risk,
  graphNodes,
  scores,
}: {
  risk: DependencyRisk
  graphNodes: GraphNode[]
  scores: ComplexityScore[]
}) {
  const hasVulnerabilities = risk.vulnerabilities.length > 0
  return (
    <>
      <div style={{ padding: `${spacing.sm}px ${spacing.md}px 0` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing.xs, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, color: colors.textPrimary }}>{risk.package}</strong>
          <span style={{ fontSize: 11, color: colors.textDim }}>
            {risk.version ?? 'unknown version'} · {risk.ecosystem}
          </span>
        </div>
        {hasVulnerabilities ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: spacing.xs }}>
            {risk.vulnerabilities.map((vuln) => (
              <a
                key={vuln.id}
                href={`https://osv.dev/vulnerability/${vuln.id}`}
                target="_blank"
                rel="noreferrer"
                className="sv-interactive"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: radius.full,
                  border: `1px solid ${colors.danger}`,
                  color: colors.danger,
                  textDecoration: 'none',
                }}
              >
                {vuln.id}
              </a>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 11, color: colors.success, margin: `${spacing.xs}px 0 0` }}>
            No known vulnerabilities
          </p>
        )}
        <p style={{ fontSize: 11, color: colors.textMuted, margin: `${spacing.xs}px 0 0` }}>
          {risk.importer_node_ids.length === 0
            ? 'No files in this repo import this package directly.'
            : `Imported by ${risk.importer_node_ids.length} file${risk.importer_node_ids.length === 1 ? '' : 's'} in this repo:`}
        </p>
      </div>
      {risk.importer_node_ids.length > 0 && (
        <PackageImportersGraph
          packageName={risk.package}
          hasVulnerabilities={hasVulnerabilities}
          importerNodeIds={risk.importer_node_ids}
          graphNodes={graphNodes}
          scores={scores}
        />
      )}
    </>
  )
}

function diffModeLabel(mode: DiffMode): string {
  if (mode.kind === 'last-look') return 'vs last look'
  return mode.toLabel ? `${mode.label} → ${mode.toLabel}` : `vs ${mode.label}`
}

function DiffPanel({
  diff,
  onSelectNode,
  graphNodeById,
  selectedNodeId,
}: {
  diff: DiffState
  onSelectNode: (nodeId: string) => void
  graphNodeById: ReadonlyMap<string, GraphNode>
  selectedNodeId: string | null
}) {
  if (diff.status === 'loading') {
    return <p style={{ color: colors.textMuted }}>Comparing…</p>
  }
  if (diff.status === 'error') {
    return (
      <p role="alert" style={{ color: colors.danger, marginBottom: spacing.lg }}>
        {diff.message}
      </p>
    )
  }

  const { result, mode } = diff
  if (!result.available) {
    return (
      <p style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
        No earlier snapshot to compare against yet.
      </p>
    )
  }
  if (result.added.length === 0 && result.removed.length === 0 && result.changed.length === 0) {
    return (
      <p style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
        No changes {diffModeLabel(mode)}.
      </p>
    )
  }

  return (
    <div
      style={{
        marginBottom: spacing.lg,
        paddingBottom: spacing.md,
        borderBottom: `1px solid ${colors.bgPanel}`,
      }}
    >
      <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: colors.textMuted, margin: `0 0 ${spacing.xs}px` }}>
        Changes {diffModeLabel(mode)}
      </h4>
      {result.changed.length > 0 && (
        <DiffSection title="Changed" count={result.changed.length}>
          {result.changed.map((change) => {
            const delta = change.after.cyclomatic_complexity - change.before.cyclomatic_complexity
            const deltaColor = delta > 0 ? colors.danger : delta < 0 ? colors.success : colors.textDim
            return (
              <RankedFunctionRow
                key={change.node_id}
                nodeId={change.node_id}
                graphNode={graphNodeById.get(change.node_id)}
                selected={change.node_id === selectedNodeId}
                onSelect={() => onSelectNode(change.node_id)}
                badges={[
                  {
                    label: `Complexity ${change.before.cyclomatic_complexity} → ${change.after.cyclomatic_complexity}`,
                    color: deltaColor,
                  },
                ]}
              />
            )
          })}
        </DiffSection>
      )}
      {result.added.length > 0 && (
        <DiffSection title="Added" count={result.added.length}>
          {result.added.map((score) => (
            <RankedFunctionRow
              key={score.node_id}
              nodeId={score.node_id}
              graphNode={graphNodeById.get(score.node_id)}
              selected={score.node_id === selectedNodeId}
              onSelect={() => onSelectNode(score.node_id)}
              badges={[
                { label: `Complexity ${score.cyclomatic_complexity}`, color: complexityToColor(score.cyclomatic_complexity) },
              ]}
            />
          ))}
        </DiffSection>
      )}
      {result.removed.length > 0 && (
        <DiffSection title="Removed" count={result.removed.length}>
          {result.removed.map((score) => (
            // Disabled: the node no longer exists in the refreshed graph,
            // so selecting it would silently do nothing.
            <RankedFunctionRow
              key={score.node_id}
              nodeId={score.node_id}
              graphNode={graphNodeById.get(score.node_id)}
              selected={false}
              onSelect={() => {}}
              disabled
              badges={[{ label: `Complexity ${score.cyclomatic_complexity}` }]}
            />
          ))}
        </DiffSection>
      )}
    </div>
  )
}

function DiffSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <div style={{ marginBottom: spacing.sm }}>
      <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: colors.textMuted, margin: `0 0 ${spacing.xs}px` }}>
        {title} <span style={{ color: colors.textDim }}>({count})</span>
      </h4>
      {children}
    </div>
  )
}
