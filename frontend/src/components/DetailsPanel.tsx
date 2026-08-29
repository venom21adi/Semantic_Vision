import type { Caller, ComplexityScore, DocProvider, GraphNode, ImpactResponse } from '../api/types'
import { formatNodeLabel } from '../graph/accessorLabel'
import { colors, spacing } from '../theme'
import { CollapseToggle } from './CollapseToggle'
import { DataSourcePane } from './DataSourcePane'
import { DocPane } from './DocPane'
import { escapedPlainText, highlightSource } from './highlightSource'
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
  | { kind: 'dataSource' }
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
  /** Repo path, needed by the performance report pane's caller drill-down
   * and the data-source pane's ingest calls. */
  repoPath: string
  onDataSourceIngestComplete: () => void
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
  onDataSourceIngestComplete,
  collapsed = false,
  onToggleCollapsed = () => {},
}: DetailsPanelProps) {
  if (collapsed) {
    return (
      <aside
        style={{
          width: 28,
          flexShrink: 0,
          borderLeft: `1px solid ${colors.bgPanel}`,
        }}
      >
        <CollapseToggle
          collapsed
          onClick={onToggleCollapsed}
          edge="right"
          paneName="details panel"
          fill
        />
      </aside>
    )
  }

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: `1px solid ${colors.bgPanel}`,
        padding: spacing.lg,
        overflowY: 'auto',
        color: colors.textPrimary,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: spacing.sm }}>
        <CollapseToggle collapsed={false} onClick={onToggleCollapsed} edge="right" paneName="details panel" />
      </div>
      {!selectedNode && <p style={{ color: colors.textMuted }}>Select a node to see details.</p>}

      {selectedNode && (
        <div>
          <h2 style={{ fontSize: 15, margin: `0 0 ${spacing.sm}px` }}>
            {formatNodeLabel(selectedNode.label, selectedNode.accessor_kind)}
          </h2>
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: `${spacing.xs}px ${spacing.sm}px`,
            }}
          >
            <dt style={{ color: colors.textMuted }}>kind</dt>
            <dd style={{ margin: 0 }}>{selectedNode.kind}</dd>
            <dt style={{ color: colors.textMuted }}>file</dt>
            <dd style={{ margin: 0 }}>{selectedNode.file}</dd>
            <dt style={{ color: colors.textMuted }}>lines</dt>
            <dd style={{ margin: 0 }}>
              {selectedNode.line_start}-{selectedNode.line_end}
            </dd>
            {selectedNode.source && (
              <>
                <dt style={{ color: colors.textMuted }}>source</dt>
                <dd style={{ margin: 0 }}>{selectedNode.source}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {pane?.kind === 'source' && (
        <div style={{ marginTop: spacing.lg }}>
          <PaneHeader title="Source" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: colors.danger }}>
              {pane.message}
            </p>
          )}
          {pane.status === 'loaded' && (() => {
            const highlighted = highlightSource(pane.source, selectedNode?.file ?? '')
            return (
              <pre
                style={{
                  background: colors.bgPage,
                  border: `1px solid ${colors.bgPanel}`,
                  borderRadius: 6,
                  padding: 10,
                  overflowX: 'auto',
                  fontSize: 12,
                  whiteSpace: 'pre',
                }}
              >
                <code
                  className={highlighted ? `hljs language-${highlighted.language}` : undefined}
                  // Both branches are pre-escaped: `highlightSource` returns
                  // hljs's own escaped output, and `escapedPlainText` escapes
                  // the raw source by hand for a file extension with no
                  // registered grammar -- never raw, unescaped `pane.source`.
                  dangerouslySetInnerHTML={{
                    __html: highlighted ? highlighted.html : escapedPlainText(pane.source),
                  }}
                />
              </pre>
            )
          })()}
        </div>
      )}

      {pane?.kind === 'doc' && (
        <div style={{ marginTop: spacing.lg }}>
          <PaneHeader title="Document" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
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
        <div style={{ marginTop: spacing.lg }}>
          <PaneHeader title="Impact Analysis" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: colors.danger }}>
              {pane.message}
            </p>
          )}
          {pane.status === 'loaded' && (
            <ImpactCallers result={pane.result} onSelectCaller={onSelectCaller} />
          )}
        </div>
      )}

      {pane?.kind === 'complexity' && (
        <div style={{ marginTop: spacing.lg }}>
          <PaneHeader title="Performance Report" onClose={onClosePane} />
          {pane.status === 'loading' && <p style={{ color: colors.textMuted }}>Loading…</p>}
          {pane.status === 'error' && (
            <p role="alert" style={{ color: colors.danger }}>
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

      {pane?.kind === 'dataSource' && (
        <div style={{ marginTop: spacing.lg }}>
          <PaneHeader title="Add tables & models" onClose={onClosePane} />
          <DataSourcePane path={repoPath} onIngestComplete={onDataSourceIngestComplete} />
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
        marginBottom: spacing.sm,
      }}
    >
      <h3 style={{ fontSize: 13, margin: 0 }}>{title}</h3>
      <button
        type="button"
        aria-label={`Close ${title} panel`}
        title={`Close ${title} panel`}
        onClick={onClose}
        className="sv-interactive"
        style={{
          background: 'transparent',
          border: 'none',
          color: colors.textMuted,
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
    return <p style={{ color: colors.textMuted }}>No callers found.</p>
  }

  const direct = result.callers.filter((caller) => caller.direct)
  const transitive = result.callers.filter((caller) => !caller.direct)

  return (
    <div>
      {result.cycles.length > 0 && (
        <p role="alert" style={{ color: colors.danger, margin: `0 0 ${spacing.sm}px` }}>
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
    <div style={{ marginBottom: spacing.md }}>
      <h4
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: colors.textMuted,
          margin: `0 0 ${spacing.xs}px`,
        }}
      >
        {title}
      </h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {callers.map((caller) => (
          <li key={caller.id}>
            <button
              type="button"
              aria-label={`View caller ${caller.id}`}
              onClick={() => onSelectCaller(caller.id)}
              className="sv-interactive"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: colors.textPrimary,
                padding: `${spacing.xs}px 0`,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {caller.id} <span style={{ color: colors.textDim }}>(depth {caller.depth})</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
