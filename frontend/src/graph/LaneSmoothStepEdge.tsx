import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { FlowEdgeData } from './transform'

/**
 * `offset` (px) passed to `getSmoothStepPath` below -- gaps each endpoint
 * before the path bends. Passed explicitly (rather than relying on the
 * library's own default of 20) so `isDownwardEdge`'s threshold, which has
 * to replicate the library's internal gap math to pick the right axis (see
 * below), can never silently drift out of sync with it.
 */
const EDGE_GAP = 20

/**
 * Mirrors `getSmoothStepPath`'s own internal branch selection (verified by
 * reading `@xyflow/system`'s `getPoints`, and independently confirmed by
 * calling `getSmoothStepPath` directly and diffing its output): for this
 * app's always Bottom-source/Top-target edges, it only takes the
 * "downward" branch -- where path geometry is driven by `centerY`, and
 * `centerX` is label-only -- when the *gapped* target is genuinely below
 * the *gapped* source, i.e. `targetY > sourceY + 2 * EDGE_GAP`, not merely
 * `targetY >= sourceY`. For any smaller gap (including exactly equal `Y`,
 * or `targetY` slightly less than `sourceY`), it takes the other branch,
 * where `centerX` drives the path and `centerY` is label-only.
 *
 * A first version of `LaneSmoothStepEdge` used the looser `targetY >=
 * sourceY` check. That's wrong for any pair of connected nodes whose `Y`
 * gap is under 40px -- reachable any time a user drags a node close to (or
 * level with) one it's connected to, since node positions are draggable
 * and auto-saved (see `onAutoSavePositions` in `GraphCanvas.tsx`), not just
 * a hypothetical. In that range the old code kept shifting `centerY`,
 * which that branch ignores for the path -- silently reproducing the
 * original overlapping-edges bug this component exists to fix, *and*
 * moving the label to a `Y` that no longer sits on the (unmoved) line at
 * all. Exported so the boundary itself can be unit-tested without
 * rendering (`.react-flow__edge` never renders under this project's
 * Vitest/jsdom setup -- see `GraphCanvas.test.tsx`).
 */
export function isDownwardEdge(sourceY: number, targetY: number): boolean {
  return sourceY + EDGE_GAP < targetY - EDGE_GAP
}

/**
 * Same visual routing as React Flow's built-in smoothstep edge, except the
 * path's bend point (and therefore its label) can be shifted by
 * `data.laneOffset` -- see `computeLaneOffsets` in `transform.ts` for why
 * that's needed, and `isDownwardEdge` above for why the offset has to be
 * routed to a different `getSmoothStepPath` parameter depending on the
 * edge's actual direction rather than always to `centerX` or always to
 * `centerY`.
 *
 * An edge with `laneOffset: 0` (the common case: no other edge shares
 * either of its endpoints) still passes the exact values the library would
 * have picked itself, so it renders pixel-identical to the default
 * smoothstep edge.
 */
export function LaneSmoothStepEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  label,
  labelStyle,
  data,
}: EdgeProps) {
  const laneOffset = (data as FlowEdgeData | undefined)?.laneOffset ?? 0
  const isDownward = isDownwardEdge(sourceY, targetY)
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    offset: EDGE_GAP,
    centerX: (sourceX + targetX) / 2 + (isDownward ? 0 : laneOffset),
    centerY: (sourceY + targetY) / 2 + (isDownward ? laneOffset : 0),
  })

  return (
    <BaseEdge
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      style={style}
      markerEnd={markerEnd}
    />
  )
}
