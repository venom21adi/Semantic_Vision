import type { Caller, GraphNode, ImpactResponse } from '../api/types'

export type ActivePane =
  | { kind: 'source'; status: 'loading' }
  | { kind: 'source'; status: 'loaded'; source: string }
  | { kind: 'source'; status: 'error'; message: string }
  | { kind: 'doc'; status: 'loading' }
  | { kind: 'doc'; status: 'loaded'; markdown: string }
  | { kind: 'doc'; status: 'not-found' }
  | { kind: 'doc'; status: 'error'; message: string }
  | { kind: 'impact'; status: 'loading' }
  | { kind: 'impact'; status: 'loaded'; result: ImpactResponse }
  | { kind: 'impact'; status: 'error'; message: string }
  | null

interface DetailsPanelProps {
  selectedNode: GraphNode | null
  pane: ActivePane
  onSelectCaller: (nodeId: string) => void
  onClosePane: () => void
}

export function DetailsPanel({ selectedNode, pane, onSelectCaller, onClosePane }: DetailsPanelProps) {
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
          <PaneHeader title="Source" onClose={onClosePane} />
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

      {pane?.kind === 'doc' && (
        <div style={{ marginTop: 16 }}>
          <PaneHeader title="Document" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: '#94a3b8' }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: '#fca5a5' }}>
              {pane.message}
            </p>
          )}
          {pane.status === 'not-found' && (
            <p style={{ color: '#94a3b8' }}>
              No saved documentation yet. AI documentation generation is not implemented yet.
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
                whiteSpace: 'pre-wrap',
              }}
            >
              {pane.markdown}
            </pre>
          )}
        </div>
      )}

      {pane?.kind === 'impact' && (
        <div style={{ marginTop: 16 }}>
          <PaneHeader title="Impact Analysis" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: '#94a3b8' }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: '#fca5a5' }}>
              {pane.message}
            </p>
          )}
          {pane.status === 'loaded' && (
            <ImpactCallers result={pane.result} onSelectCaller={onSelectCaller} />
          )}
        </div>
      )}
    </aside>
  )
}

function PaneHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
      }}
    >
      <h3 style={{ fontSize: 13, margin: 0 }}>{title}</h3>
      <button
        type="button"
        aria-label={`Close ${title} panel`}
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

function ImpactCallers({
  result,
  onSelectCaller,
}: {
  result: ImpactResponse
  onSelectCaller: (nodeId: string) => void
}) {
  if (result.callers.length === 0) {
    return <p style={{ color: '#94a3b8' }}>No callers found.</p>
  }

  const direct = result.callers.filter((caller) => caller.direct)
  const transitive = result.callers.filter((caller) => !caller.direct)

  return (
    <div>
      {result.cycles.length > 0 && (
        <p role="alert" style={{ color: '#fca5a5', margin: '0 0 8px' }}>
          Circular call chain detected.
        </p>
      )}
      {direct.length > 0 && (
        <CallerGroup title="Direct callers" callers={direct} onSelectCaller={onSelectCaller} />
      )}
      {transitive.length > 0 && (
        <CallerGroup
          title="Transitive callers"
          callers={transitive}
          onSelectCaller={onSelectCaller}
        />
      )}
    </div>
  )
}

function CallerGroup({
  title,
  callers,
  onSelectCaller,
}: {
  title: string
  callers: Caller[]
  onSelectCaller: (nodeId: string) => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 4px' }}>
        {title}
      </h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {callers.map((caller) => (
          <li key={caller.id}>
            <button
              type="button"
              aria-label={`View caller ${caller.id}`}
              onClick={() => onSelectCaller(caller.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: '#f8fafc',
                padding: '4px 0',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {caller.id} <span style={{ color: '#64748b' }}>(depth {caller.depth})</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
