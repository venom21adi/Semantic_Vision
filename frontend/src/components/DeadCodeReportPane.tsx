import { useMemo, useState } from 'react'
import type { DeadCodeCandidate, GraphNode } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { colors, radius, spacing } from '../theme'
import { RankedFunctionRow } from './RankedFunctionRow'

interface DeadCodeReportPaneProps {
  candidates: DeadCodeCandidate[]
  graphNodes: GraphNode[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

const controlStyle = {
  background: colors.bgPage,
  color: colors.textPrimary,
  border: `1px solid ${colors.bgPanel}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  fontSize: 12,
} as const

// Mirrors `HotspotReportPane`'s shape (a standalone pane, not a
// `PerformanceReportPane` sort mode) for the same reason -- a different
// data shape and no complexity-report-specific legend/drill-down to reuse.
// No severity badge: unlike hotspot score or complexity, "dead code" isn't
// a magnitude to shade, just a yes/no candidate list -- so there's also
// nothing to sort by besides name.
export function DeadCodeReportPane({
  candidates,
  graphNodes,
  selectedNodeId,
  onSelectNode,
}: DeadCodeReportPaneProps) {
  const [query, setQuery] = useState('')

  const graphNodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = candidates.filter((candidate) => {
      if (!q) return true
      const node = graphNodeById.get(candidate.node_id)
      const name = node ? formatNodeLabel(node.label, node.accessor_kind).toLowerCase() : ''
      const file = node?.file.toLowerCase() ?? ''
      return name.includes(q) || file.includes(q) || candidate.node_id.toLowerCase().includes(q)
    })
    return [...filtered].sort((a, b) => {
      const nameOf = (id: string) => {
        const node = graphNodeById.get(id)
        return node ? formatNodeLabel(node.label, node.accessor_kind) : id
      }
      return nameOf(a.node_id).localeCompare(nameOf(b.node_id))
    })
  }, [candidates, query, graphNodeById])

  if (candidates.length === 0) {
    return <p style={{ color: colors.textMuted }}>No dead-code candidates found.</p>
  }

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textMuted }}>
        Functions with no callers anywhere in this repo's call graph, after excluding decorated
        functions, test files/names, dunder methods, and <code>main</code> entry points.
        Candidates to review, not a verdict — a caller outside this repo (a library's public API,
        a framework this tool doesn't recognize) can still be real.
      </p>
      <div style={{ marginBottom: spacing.sm }}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name or file"
          aria-label="Filter functions"
          style={{ ...controlStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      {visible.length === 0 ? (
        <p style={{ color: colors.textMuted }}>No candidates match this filter.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map((candidate) => (
            <li key={candidate.node_id}>
              <RankedFunctionRow
                nodeId={candidate.node_id}
                graphNode={graphNodeById.get(candidate.node_id)}
                selected={candidate.node_id === selectedNodeId}
                onSelect={() => onSelectNode(candidate.node_id)}
                badges={[]}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
