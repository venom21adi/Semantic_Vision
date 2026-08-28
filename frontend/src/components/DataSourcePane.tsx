import { useState, type FormEvent } from 'react'
import { ApiError, ingestDbConnection, ingestDbtManifest } from '../api/client'
import { colors, radius, spacing } from '../theme'

interface DataSourcePaneProps {
  path: string
  /** Called after either ingest succeeds, so the caller can re-fetch the
   * graph -- the new `Table`/`DBT_MODEL` nodes/edges only exist in the
   * backend's cached `ParseResult` until then, not yet in this app's own
   * `nodes`/`edges` state. */
  onIngestComplete: () => void
}

type IngestState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; summary: string }
  | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

export function DataSourcePane({ path, onIngestComplete }: DataSourcePaneProps) {
  const [manifestPath, setManifestPath] = useState('')
  const [manifestState, setManifestState] = useState<IngestState>({ status: 'idle' })
  const [connectionString, setConnectionString] = useState('')
  const [connectionState, setConnectionState] = useState<IngestState>({ status: 'idle' })

  async function handleManifestSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = manifestPath.trim()
    if (!trimmed) return
    setManifestState({ status: 'submitting' })
    try {
      const result = await ingestDbtManifest(path, trimmed)
      setManifestState({
        status: 'success',
        summary: `${result.models_ingested} model${result.models_ingested === 1 ? '' : 's'} ingested — ${result.tables_reconciled} table${result.tables_reconciled === 1 ? '' : 's'} matched, ${result.tables_created} new.`,
      })
      onIngestComplete()
    } catch (error) {
      setManifestState({ status: 'error', message: errorMessage(error) })
    }
  }

  async function handleConnectionSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = connectionString.trim()
    if (!trimmed) return
    setConnectionState({ status: 'submitting' })
    try {
      const result = await ingestDbConnection(path, trimmed)
      setConnectionState({
        status: 'success',
        summary: `${result.tables_ingested} table${result.tables_ingested === 1 ? '' : 's'} introspected — ${result.tables_reconciled} matched, ${result.tables_created} new.`,
      })
      onIngestComplete()
    } catch (error) {
      setConnectionState({ status: 'error', message: errorMessage(error) })
    } finally {
      // The connection string only ever lives in this input's own state
      // and the single in-flight request above -- cleared right after
      // use either way, not just on success. It can genuinely embed a
      // real credential, and this field's own "held only for this
      // request" promise should hold even when the request fails; the
      // cost is retyping it to fix a typo, not a real loss.
      setConnectionString('')
    }
  }

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 11, color: colors.textMuted }}>
        Connect a dbt project or a live database to add its tables and models to this
        graph — reconciled by table name against anything already detected from your code.
      </p>

      <form
        onSubmit={(event) => void handleManifestSubmit(event)}
        style={{ marginBottom: spacing.lg }}
      >
        <label
          htmlFor="dbt-manifest-path"
          style={{ display: 'block', fontSize: 12, marginBottom: spacing.xs }}
        >
          dbt manifest.json path
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="dbt-manifest-path"
            type="text"
            value={manifestPath}
            onChange={(event) => setManifestPath(event.target.value)}
            placeholder="/repo/target/manifest.json"
            aria-label="dbt manifest.json path"
            title="Path to a manifest.json your own `dbt compile` already produced"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '5px 8px',
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: colors.bgPage,
              color: colors.textPrimary,
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={manifestState.status === 'submitting' || manifestPath.trim().length === 0}
            className="sv-interactive"
            style={{
              padding: '5px 10px',
              borderRadius: radius.sm,
              border: 'none',
              background: manifestState.status === 'submitting' ? colors.disabled : colors.accent,
              color: colors.textPrimary,
              fontSize: 12,
              cursor: manifestState.status === 'submitting' ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            {manifestState.status === 'submitting' ? 'Ingesting…' : 'Ingest'}
          </button>
        </div>
        {manifestState.status === 'success' && (
          <p role="status" style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.success }}>
            {manifestState.summary}
          </p>
        )}
        {manifestState.status === 'error' && (
          <p role="alert" style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.danger }}>
            {manifestState.message}
          </p>
        )}
      </form>

      <form onSubmit={(event) => void handleConnectionSubmit(event)}>
        <label
          htmlFor="db-connection-string"
          style={{ display: 'block', fontSize: 12, marginBottom: spacing.xs }}
        >
          Database connection string (read-only)
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="db-connection-string"
            type="password"
            value={connectionString}
            onChange={(event) => setConnectionString(event.target.value)}
            placeholder="postgresql://readonly@host/db"
            aria-label="Database connection string"
            title="A read-only connection string -- held only for this one request, never saved"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '5px 8px',
              borderRadius: radius.sm,
              border: `1px solid ${colors.border}`,
              background: colors.bgPage,
              color: colors.textPrimary,
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={
              connectionState.status === 'submitting' || connectionString.trim().length === 0
            }
            className="sv-interactive"
            style={{
              padding: '5px 10px',
              borderRadius: radius.sm,
              border: 'none',
              background: connectionState.status === 'submitting' ? colors.disabled : colors.accent,
              color: colors.textPrimary,
              fontSize: 12,
              cursor: connectionState.status === 'submitting' ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            {connectionState.status === 'submitting' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
        <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: 10, color: colors.textDim }}>
          Held only for this request — never saved or sent anywhere else.
        </p>
        {connectionState.status === 'success' && (
          <p role="status" style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.success }}>
            {connectionState.summary}
          </p>
        )}
        {connectionState.status === 'error' && (
          <p role="alert" style={{ margin: `${spacing.xs}px 0 0`, fontSize: 11, color: colors.danger }}>
            {connectionState.message}
          </p>
        )}
      </form>
    </div>
  )
}
