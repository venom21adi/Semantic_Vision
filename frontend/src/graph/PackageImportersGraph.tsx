import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect } from 'react'
import type { ComplexityScore, GraphNode } from '../api/types'
import { colors, font } from '../theme'
import { formatNodeLabel } from './accessorLabel'
import { complexityToColor } from './heatmap'
import { layoutGraph } from './layout'

export interface PackageImportersGraphProps {
  packageName: string
  hasVulnerabilities: boolean
  importerNodeIds: string[]
  graphNodes: GraphNode[]
  scores: ComplexityScore[]
}

interface ImportGraphNodeData extends Record<string, unknown> {
  label: string
  color: string
  border: string
  isPackage: boolean
}

// Every real node id this app generates has the shape `{rel_path}::...` or
// is a bare relative path (see `resolver/symbol_table.py`, `resolver/calls.py`,
// `dataflow/sqlalchemy_parser.py`) -- a relative path can never start with
// `:` on any platform, so a leading colon here is a provable, not just
// improbable, guarantee this synthetic id can never collide with a real one.
const PACKAGE_NODE_ID_PREFIX = '::dependency-package::'

function ImportGraphNode({ data }: NodeProps) {
  const nodeData = data as ImportGraphNodeData
  return (
    <div
      title={nodeData.label}
      style={{
        background: nodeData.color,
        border: `2px solid ${nodeData.border}`,
        borderRadius: nodeData.isPackage ? 16 : 6,
        padding: '6px 10px',
        minWidth: 120,
        maxWidth: 220,
        color: colors.textPrimary,
        fontSize: 11,
        fontWeight: nodeData.isPackage ? 700 : 400,
        fontFamily: font.ui,
        textAlign: 'center',
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const importGraphNodeTypes = { default: ImportGraphNode }

function computeFlowNodes(
  packageName: string,
  hasVulnerabilities: boolean,
  importers: GraphNode[],
  scores: ComplexityScore[],
): Node<ImportGraphNodeData>[] {
  const scoreById = new Map(scores.map((score) => [score.node_id, score]))
  const packageNodeId = `${PACKAGE_NODE_ID_PREFIX}${packageName}`

  const packageNode: Node<ImportGraphNodeData> = {
    id: packageNodeId,
    type: 'default',
    position: { x: 0, y: 0 },
    data: {
      label: packageName,
      color: colors.bgPanel,
      border: hasVulnerabilities ? colors.danger : colors.accent,
      isPackage: true,
    },
  }

  const importerNodes: Node<ImportGraphNodeData>[] = importers.map((node) => {
    const score = scoreById.get(node.id)
    return {
      id: node.id,
      type: 'default',
      position: { x: 0, y: 0 },
      data: {
        label: formatNodeLabel(node.label, node.accessor_kind),
        color: score ? complexityToColor(score.cyclomatic_complexity) : colors.textDim,
        border: 'transparent',
        isPackage: false,
      },
    }
  })

  return layoutGraph(
    [packageNode, ...importerNodes],
    importers.map((node) => ({ id: `${node.id}->${packageNodeId}`, source: node.id, target: packageNodeId })),
    'TB',
  )
}

function computeFlowEdges(packageName: string, importers: GraphNode[]): Edge[] {
  const packageNodeId = `${PACKAGE_NODE_ID_PREFIX}${packageName}`
  return importers.map((node) => ({
    id: `${node.id}->${packageNodeId}`,
    source: node.id,
    target: packageNodeId,
    style: { stroke: colors.borderSubtle },
  }))
}

function PackageImportersGraphInner({
  packageName,
  hasVulnerabilities,
  importerNodeIds,
  graphNodes,
  scores,
}: PackageImportersGraphProps) {
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]))
  const importers = importerNodeIds
    .map((id) => graphNodeById.get(id))
    .filter((node): node is GraphNode => node !== undefined)

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(
    computeFlowNodes(packageName, hasVulnerabilities, importers, scores),
  )
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(
    computeFlowEdges(packageName, importers),
  )

  useEffect(() => {
    setFlowNodes(computeFlowNodes(packageName, hasVulnerabilities, importers, scores))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFlowNodes is stable
  }, [packageName, hasVulnerabilities, importerNodeIds, graphNodes, scores])

  useEffect(() => {
    setFlowEdges(computeFlowEdges(packageName, importers))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFlowEdges is stable
  }, [packageName, importerNodeIds, graphNodes])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={importGraphNodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
    </ReactFlow>
  )
}

/** A small, read-only graph answering "which of this repo's own files
 * actually import this package" -- a package's blast radius inside the
 * codebase, not just whether osv.dev flags it. Structurally cloned from
 * `MiniCallGraph.tsx` rather than reusing it: a package isn't a `NodeKind`
 * (`api/types.ts`'s closed union has no `'package'` variant), and
 * `MiniCallGraph`'s edge filter is hardcoded to call edges -- bending both
 * across two unrelated call sites for this one new mode wasn't worth it
 * for a component this small. Importer nodes are colored via the same
 * `complexityToColor` every other ranked list/graph already uses, so this
 * reads as one consistent color language with the rest of the dashboard.
 * Read-only: importer nodes aren't clickable in this first pass -- nothing
 * here needs `nodesDraggable` either, since there's no drag-position state
 * to preserve for a graph this simple. */
export function PackageImportersGraph(props: PackageImportersGraphProps) {
  return (
    <ReactFlowProvider>
      <PackageImportersGraphInner {...props} />
    </ReactFlowProvider>
  )
}
