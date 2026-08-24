import type { Caller, ComplexityScore, DocProvider, GraphNode, ImpactResponse } from '../api/types'
import { CollapseToggle } from './CollapseToggle'
import { DocPane } from './DocPane'
import { PerformanceReportPane } from './PerformanceReportPane'

export type ActivePane =
  | { kind: 'source'; status: 'loading' }
  | { kind: 'source'; status: 'loaded'; source: string }
  | { kind: 'source'; status: 'error'; message: string }
  | { kind: 'doc'; status: 'loading' }
  | { kind: 'doc'; status: 'not-found' }
  | { kind: 'doc'; status: 'generating'; markdown: string }
  | { kind: 'doc'; status: 'loaded'; markdown: string; saved: boolean }
  | { kind: 'doc'; status: 'error'; message: string }
  | { kind: 'impact'; status: 'loading' }
  | { kind: 'impact'; status: 'loaded'; result: ImpactResponse }
  | { kind: 'impact'; status: 'error'; message: string }
  | { kind: 'complexity'; status: 'loading' }
  | { kind: 'complexity'; status: 'loaded'; scores: ComplexityScore[] }
  | { kind: 'complexity'; status: 'error'; message: string }
  | null

interface DetailsPanelProps {
  selectedNode: GraphNode | null
  pane: ActivePane
  onSelectCaller: (nodeId: string) => void
  onClosePane: () => void
  docProvider: DocProvider
  onDocProviderChange: (provider: DocProvider) => void
  ollamaModels: string[]
  ollamaModelsLoading: boolean
  ollamaModel: string
  onOllamaModelChange: (model: string) => void
  onRefreshOllamaModels: () => void
  onGenerateDoc: () => void
  onSaveDoc: () => void
  onEditDoc: (markdown: string) => void
  docRoot: string
  docSaveNoticeDismissed: boolean
  onDismissDocSaveNotice: () => void
  /** Repo path, needed by the performance report pane's caller drill-down. */
  repoPath: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function DetailsPanel({
  selectedNode,
  pane,
  onSelectCaller,
  onClosePane,
  docProvider,
  onDocProviderChange,
  ollamaModels,
  ollamaModelsLoading,
  ollamaModel,
  onOllamaModelChange,
  onRefreshOllamaModels,
  onGenerateDoc,
  onSaveDoc,
  onEditDoc,
  docRoot,
  docSaveNoticeDismissed,
  onDismissDocSaveNotice,
  repoPath,
  collapsed = false,
  onToggleCollapsed = () => {},
}: DetailsPanelProps) {
  if (collapsed) {
    return (
      <aside
        style={{
          width: 28,
          flexShrink: 0,
          borderLeft: '1px solid #1e293b',
          padding: '8px 4px',
        }}
      >
        <CollapseToggle collapsed onClick={onToggleCollapsed} edge="right" paneName="details panel" />
      </aside>
    )
  }

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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <CollapseToggle collapsed={false} onClick={onToggleCollapsed} edge="right" paneName="details panel" />
      </div>
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
          {pane.status !== 'loading' && (
            <DocPane
              pane={pane}
              provider={docProvider}
              onProviderChange={onDocProviderChange}
              ollamaModels={ollamaModels}
              ollamaModelsLoading={ollamaModelsLoading}
              ollamaModel={ollamaModel}
              onOllamaModelChange={onOllamaModelChange}
              onRefreshOllamaModels={onRefreshOllamaModels}
              onGenerate={onGenerateDoc}
              onSave={onSaveDoc}
              onEditMarkdown={onEditDoc}
              docRoot={docRoot}
              fileName={
                selectedNode?.label
                  ? selectedNode.label.replace(/[^a-zA-Z0-9._-]+/g, '_')
                  : 'documentation'
              }
              noticeDismissed={docSaveNoticeDismissed}
              onDismissNotice={onDismissDocSaveNotice}
            />
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

      {pane?.kind === 'complexity' && (
        <div style={{ marginTop: 16 }}>
          <PaneHeader title="Performance Report" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: '#94a3b8' }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: '#fca5a5' }}>
              {pane.message}
            </p>
          )}
          {pane.status === 'loaded' && (
            <PerformanceReportPane
              path={repoPath}
              scores={pane.scores}
              onSelectNode={onSelectCaller}
            />
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
