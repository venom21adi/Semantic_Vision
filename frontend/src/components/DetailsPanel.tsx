import type { GraphNode } from '../api/types'

export type ActivePane =
  | { kind: 'source'; status: 'loading' }
  | { kind: 'source'; status: 'loaded'; source: string }
  | { kind: 'source'; status: 'error'; message: string }
  | { kind: 'stub'; feature: 'Document' | 'Impact Analysis' }
  | null

interface DetailsPanelProps {
  selectedNode: GraphNode | null
  pane: ActivePane
}

export function DetailsPanel({ selectedNode, pane }: DetailsPanelProps) {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid #1e293b',
        padding: 16,
        overflowY: 'auto',
        color: '#f8fafc',
        fontSize: 13,
      }}
    >
      {!selectedNode && <p style={{ color: '#94a3b8' }}>Select a node to see details.</p>}

      {selectedNode && (
        <div>
          <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>{selectedNode.label}</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px' }}>
            <dt style={{ color: '#94a3b8' }}>kind</dt>
            <dd style={{ margin: 0 }}>{selectedNode.kind}</dd>
            <dt style={{ color: '#94a3b8' }}>file</dt>
            <dd style={{ margin: 0 }}>{selectedNode.file}</dd>
            <dt style={{ color: '#94a3b8' }}>lines</dt>
            <dd style={{ margin: 0 }}>
              {selectedNode.line_start}-{selectedNode.line_end}
            </dd>
          </dl>
        </div>
      )}

      {pane?.kind === 'source' && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Source</h3>
          {pane.status === 'loading' && <p style={{ color: '#94a3b8' }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: '#fca5a5' }}>
              {pane.message}
            </p>
          )}
          {pane.status === 'loaded' && (
            <pre
              style={{
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 6,
                padding: 10,
                overflowX: 'auto',
                fontSize: 12,
                whiteSpace: 'pre',
              }}
            >
              {pane.source}
            </pre>
          )}
        </div>
      )}

      {pane?.kind === 'stub' && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>{pane.feature}</h3>
          <p style={{ color: '#94a3b8' }}>{pane.feature} is not implemented yet.</p>
        </div>
      )}
    </aside>
  )
}
