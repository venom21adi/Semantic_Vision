import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ComplexityScore, NodePosition } from '../api/types'
import type { ContainerVisibility } from './collapseDirectories'
import { ContextMenu, type ContextMenuTarget } from './ContextMenu'
import { complexityToColor } from './heatmap'
import { nodeTypes, type GraphNodeData } from './nodeTypes'
import { neighborNodeIds } from './transform'

export const LARGE_GRAPH_NODE_THRESHOLD = 300
export const AUTO_SAVE_POSITIONS_INTERVAL_MS = 60_000
const DIMMED_NODE_OPACITY = 0.25
const DIMMED_EDGE_OPACITY = 0.1

export interface GraphHighlight {
  nodeIds: ReadonlySet<string>
  /** Keys of the form `${source}->${target}`, matching each edge's own
   * source/target ids (kind-independent, since a highlighted chain is
   * always a `calls` chain in practice). */
  edgeKeys: ReadonlySet<string>
}

export interface GraphCanvasProps {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  onDocument: (nodeId: string) => void
  onImpactAnalysis: (nodeId: string) => void
  onViewSource: (nodeId: string) => void
  onExecutionFlowchart: (nodeId: string) => void
  /** Called instead of `onSelectNode` when a directory or file node is
   * clicked -- toggles that container's expand/collapse state one level. */
  onToggleContainer: (containerId: string) => void
  /** Expand/collapse state and hidden-descendant count for every currently
   * visible directory/file node, from `collapseGraph`. Only meaningful in
   * the codebase view (a file-scoped graph never contains directory
   * nodes, and its one file node is always the scope root); omit or leave
   * undefined otherwise. */
  containerState?: ReadonlyMap<string, ContainerVisibility>
  /** Set when the chevron was just clicked on a container with too many
   * direct children to expand onto the canvas at once -- rendered as a
   * dismissible-by-time banner telling the user the count and pointing
   * them at the sidebar checkboxes instead. `null`/omitted renders
   * nothing. */
  expandBlockedNotice?: { label: string; count: number } | null
  /** Called every `AUTO_SAVE_POSITIONS_INTERVAL_MS` with the current node
   * positions (including any the user has dragged), so a moved layout
   * survives a reload. Omit to disable auto-save. */
  onAutoSavePositions?: (positions: Record<string, NodePosition>) => void
  /** When set, dims every node/edge not part of it (e.g. an impact
   * analysis caller chain) instead of resetting the canvas to just that
   * subset -- so the rest of the graph stays visible for context. */
  highlight?: GraphHighlight | null
  /** When set (the complexity heatmap is on), tints each function node's
   * background by its complexity score instead of the normal kind color.
   * Applied the same way `highlight` is -- as a derived overlay on the
   * already-laid-out nodes, not by feeding back into the layout pipeline,
   * so toggling it doesn't trigger a relayout or reset dragged positions. */
  complexityByNodeId?: ReadonlyMap<string, ComplexityScore> | null
}

function GraphCanvasInner({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId,
  onSelectNode,
  onDocument,
  onImpactAnalysis,
  onViewSource,
  onExecutionFlowchart,
  onToggleContainer,
  containerState,
  expandBlockedNotice,
  onAutoSavePositions,
  highlight,
  complexityByNodeId,
}: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const { fitView } = useReactFlow()
  const nodesRef = useRef(nodes)

  // The edges' own base style (color, dash pattern, external/ambiguous
  // dimming) comes from `initialEdges` and must survive highlighting --
  // restoring it exactly once a highlight clears, not just resetting to
  // opacity 1.
  const baseEdgeStyleById = useMemo(() => {
    const map = new Map<string, Edge['style']>()
    for (const edge of initialEdges) map.set(edge.id, edge.style)
    return map
  }, [initialEdges])

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    if (!onAutoSavePositions) return
    const flush = () => {
      const positions: Record<string, NodePosition> = {}
      for (const node of nodesRef.current) {
        positions[node.id] = { x: node.position.x, y: node.position.y }
      }
      onAutoSavePositions(positions)
    }
    const interval = setInterval(flush, AUTO_SAVE_POSITIONS_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      // Flushes whatever's been dragged since the last tick before this
      // canvas unmounts/remounts (e.g. switching the Codebase/File view),
      // so a drag made just before that isn't silently lost.
      flush()
    }
  }, [onAutoSavePositions])

  // Selection and highlight are rendered as a pure derivation of the raw
  // `nodes`/`edges` state, `selectedNodeId`, and `highlight` -- not as
  // effects that mutate that state -- so they can never fall out of sync
  // with it (e.g. an unrelated prop change resetting `nodes` via the
  // resync effect above, which would otherwise silently wipe an
  // already-applied `selected`/highlight style until *that* prop next
  // changes, since an effect only reruns when its own deps change).
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const selected = node.id === selectedNodeId
        const opacity = !highlight ? 1 : highlight.nodeIds.has(node.id) ? 1 : DIMMED_NODE_OPACITY
        const score = complexityByNodeId?.get(node.id)
        const heatmapColor = score ? complexityToColor(score.cyclomatic_complexity) : undefined
        const visibility = containerState?.get(node.id)
        const data = node.data as GraphNodeData
        if (
          node.selected === selected &&
          node.style?.opacity === opacity &&
          data.heatmapColor === heatmapColor &&
          data.isExpanded === visibility?.expanded &&
          data.hiddenDescendantCount === visibility?.hiddenDescendantCount
        ) {
          return node
        }
        return {
          ...node,
          selected,
          style: { ...node.style, opacity },
          data: {
            ...data,
            heatmapColor,
            isExpanded: visibility?.expanded,
            hiddenDescendantCount: visibility?.hiddenDescendantCount,
          },
        }
      }),
    [nodes, selectedNodeId, highlight, complexityByNodeId, containerState],
  )

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const baseStyle = baseEdgeStyleById.get(edge.id)
        const key = `${edge.source}->${edge.target}`
        const opacity = !highlight
          ? (baseStyle?.opacity ?? 1)
          : highlight.edgeKeys.has(key)
            ? 1
            : DIMMED_EDGE_OPACITY
        if (edge.style?.opacity === opacity) return edge
        return { ...edge, style: { ...baseStyle, opacity } }
      }),
    [edges, highlight, baseEdgeStyleById],
  )

  const handleNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      // Only the chevron itself toggles expand/collapse (see
      // `nodeTypes.tsx`'s `data-node-toggle` span) -- clicking anywhere
      // else on a directory/file node still selects it, same as any other
      // kind, since a file has real click behavior worth keeping (View
      // Source, Document, etc. via the context menu; a left-click
      // selecting it is the existing, expected gesture). Directories have
      // no such behavior today, but are treated the same way for
      // consistency -- both use the chevron, not the whole node body, as
      // the toggle target.
      // `event.target` isn't guaranteed to be an `Element` in a raw DOM
      // click (it can be a `Text` node, which has no `.closest()`) --
      // confirmed via a direct diagnostic that React Flow's own
      // `onNodeClick` always normalizes it to the node's wrapper element
      // regardless of exactly where within the node the click landed, so
      // this fallback is unreachable through this API as currently used.
      // Kept anyway as cheap defense-in-depth against that normalization
      // changing in a future `@xyflow/react` version, not because it's
      // known to fire today.
      const rawTarget = event.target
      const target =
        rawTarget instanceof Element
          ? rawTarget
          : (rawTarget as unknown as globalThis.Node).parentElement
      if (target?.closest('[data-node-toggle]')) {
        onToggleContainer(node.id)
        return
      }
      onSelectNode(node.id)
    },
    [onSelectNode, onToggleContainer],
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handlePaneClick = useCallback(() => {
    onSelectNode(null)
    closeContextMenu()
  }, [onSelectNode, closeContextMenu])

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const neighborIds = neighborNodeIds(node.id, initialEdges)
      void fitView({ nodes: neighborIds.map((id) => ({ id })), duration: 300, padding: 0.3 })
    },
    [fitView, initialEdges],
  )

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault()
      onSelectNode(node.id)
      setContextMenu({
        nodeId: node.id,
        label: (node.data as GraphNodeData).label,
        x: event.clientX,
        y: event.clientY,
      })
    },
    [onSelectNode],
  )

  const isLargeGraph = displayNodes.length > LARGE_GRAPH_NODE_THRESHOLD

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isLargeGraph && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: '#7c2d12',
            color: '#fed7aa',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Large graph: {displayNodes.length} nodes. Rendering may be slow.
        </div>
      )}
      {expandBlockedNotice && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: isLargeGraph ? 44 : 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: '#1e3a5f',
            color: '#bfdbfe',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 13,
            textAlign: 'center',
            maxWidth: 480,
          }}
        >
          "{expandBlockedNotice.label}" has {expandBlockedNotice.count} items -- too many to show at once.
          Use the sidebar checkboxes to pick specific files or subdirectories instead.
        </div>
      )}
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={handlePaneClick}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {contextMenu && (
        <ContextMenu
          target={contextMenu}
          onClose={closeContextMenu}
          onDocument={onDocument}
          onImpactAnalysis={onImpactAnalysis}
          onViewSource={onViewSource}
          onExecutionFlowchart={onExecutionFlowchart}
        />
      )}
    </div>
  )
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
