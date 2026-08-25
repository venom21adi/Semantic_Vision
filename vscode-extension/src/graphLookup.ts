/** Minimal shape this module needs from a graph node -- deliberately not
 * importing the frontend's/backend's own `GraphNode` type, since this
 * package has no dependency on either of those (avoids coupling the
 * extension's build to `frontend/`'s or `src/semantic_vision/`'s own
 * toolchains for one small structural type). */
export interface GraphNodeLike {
  id: string
  file: string
  line_start: number
  line_end: number
}

/**
 * Resolves "Impact Analysis at Cursor" to the exact node the cursor is
 * inside, using only the already-loaded graph -- no new backend endpoint
 * needed, since every node already carries its own file/line range.
 *
 * Returns the innermost match (the smallest line range containing
 * `line`), not just the first one found: a method's range is nested
 * inside its class's range, both of which contain the same cursor line,
 * and the method -- not the class -- is almost always what a user
 * right-clicking inside it means by "this function."
 */
export function findNodeAtCursor<T extends GraphNodeLike>(
  nodes: readonly T[],
  file: string,
  line: number,
): T | null {
  let best: T | null = null
  for (const node of nodes) {
    if (node.file !== file) continue
    if (line < node.line_start || line > node.line_end) continue
    if (best === null || node.line_end - node.line_start < best.line_end - best.line_start) {
      best = node
    }
  }
  return best
}
