import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import type { GraphEdge } from '../api/types'
import { colors } from '../theme'
import { EDGE_COLORS, type FlowEdgeData } from './transform'

interface EdgeLegendProps {
  edges: Edge[]
  hiddenEdgeKinds?: ReadonlySet<GraphEdge['kind']>
  onToggleEdgeKind: (kind: GraphEdge['kind']) => void
}

/** A fixed panel on the canvas itself (not the sidebar) showing one row
 * per edge kind actually present in the currently-displayed graph -- a
 * color-to-kind legend the app never had, and a checkbox to hide/show
 * that kind, doubling as the fix for a graph with several edge kinds
 * competing for the same visual space. Deliberately lists only kinds
 * present in `edges`, not every kind `EDGE_COLORS` knows about -- most
 * repos only ever have 3-4 of the 9 possible kinds, and a checkbox for a
 * kind that can't appear here would be confusing clutter, not a fix for
 * it. Swatches read `EDGE_COLORS` directly (the same table
 * `graph/transform.ts` uses to color the actual lines) so the legend can
 * never drift out of sync with what's really on screen. */
export function EdgeLegend({ edges, hiddenEdgeKinds, onToggleEdgeKind }: EdgeLegendProps) {
  const presentKinds = useMemo(() => {
    const seen = new Set<GraphEdge['kind']>()
    for (const edge of edges) {
      const kind = (edge.data as FlowEdgeData | undefined)?.kind
      if (kind) seen.add(kind)
    }
    // Stable order matching EDGE_COLORS's own declaration order, not
    // discovery order (which would jitter row order as edges load).
    return (Object.keys(EDGE_COLORS) as GraphEdge['kind'][]).filter((kind) => seen.has(kind))
  }, [edges])

  if (presentKinds.length === 0) return null

  return (
    <div
      role="group"
      aria-label="Edge kinds shown on the canvas"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        background: colors.bgPanel,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 12,
        color: colors.textPrimary,
      }}
    >
      {presentKinds.map((kind) => {
        const id = `edge-legend-${kind}`
        const visible = !hiddenEdgeKinds?.has(kind)
        return (
          <label
            key={kind}
            htmlFor={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 0',
              cursor: 'pointer',
              opacity: visible ? 1 : 0.5,
            }}
          >
            <input
              id={id}
              type="checkbox"
              checked={visible}
              onChange={() => onToggleEdgeKind(kind)}
              style={{ margin: 0, cursor: 'pointer' }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: EDGE_COLORS[kind],
                flexShrink: 0,
              }}
            />
            <span>{kind}</span>
          </label>
        )
      })}
    </div>
  )
}
