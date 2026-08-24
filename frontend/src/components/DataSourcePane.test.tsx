import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as client from '../api/client'
import { ApiError } from '../api/client'
import { DataSourcePane } from './DataSourcePane'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, ingestDbtManifest: vi.fn(), ingestDbConnection: vi.fn() }
})

const mockedClient = vi.mocked(client)

describe('DataSourcePane', () => {
  it('ingests a dbt manifest and shows a one-line summary', async () => {
    const user = userEvent.setup()
    mockedClient.ingestDbtManifest.mockResolvedValue({
      models_ingested: 2,
      tables_reconciled: 1,
      tables_created: 1,
    })
    const onIngestComplete = vi.fn()

    render(<DataSourcePane path="/repo" onIngestComplete={onIngestComplete} />)

    await user.type(screen.getByLabelText(/dbt manifest.json path/i), '/repo/target/manifest.json')
    await user.click(screen.getByRole('button', { name: /^ingest$/i }))

    expect(mockedClient.ingestDbtManifest).toHaveBeenCalledWith(
      '/repo',
      '/repo/target/manifest.json',
    )
    await waitFor(() => {
      expect(screen.getByText(/2 models ingested/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/1 table matched, 1 new/i)).toBeInTheDocument()
    expect(onIngestComplete).toHaveBeenCalledTimes(1)
  })

  it('shows an error message when the dbt manifest ingest fails', async () => {
    const user = userEvent.setup()
    mockedClient.ingestDbtManifest.mockRejectedValue(new ApiError(400, 'Not valid JSON'))
    const onIngestComplete = vi.fn()

    render(<DataSourcePane path="/repo" onIngestComplete={onIngestComplete} />)

    await user.type(screen.getByLabelText(/dbt manifest.json path/i), '/bad/manifest.json')
    await user.click(screen.getByRole('button', { name: /^ingest$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Not valid JSON')
    })
    expect(onIngestComplete).not.toHaveBeenCalled()
  })

  it('connects a database and shows a one-line summary, clearing the field after', async () => {
    const user = userEvent.setup()
    mockedClient.ingestDbConnection.mockResolvedValue({
      tables_ingested: 3,
      tables_reconciled: 2,
      tables_created: 1,
    })
    const onIngestComplete = vi.fn()

    render(<DataSourcePane path="/repo" onIngestComplete={onIngestComplete} />)

    const input = screen.getByLabelText(/database connection string/i)
    await user.type(input, 'postgresql://readonly@host/db')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(mockedClient.ingestDbConnection).toHaveBeenCalledWith(
      '/repo',
      'postgresql://readonly@host/db',
    )
    await waitFor(() => {
      expect(screen.getByText(/3 tables introspected/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/2 matched, 1 new/i)).toBeInTheDocument()
    expect(onIngestComplete).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
  })

  it('shows an error message when the db connection ingest fails, clearing the field either way', async () => {
    const user = userEvent.setup()
    mockedClient.ingestDbConnection.mockRejectedValue(new ApiError(400, 'Could not connect'))
    const onIngestComplete = vi.fn()

    render(<DataSourcePane path="/repo" onIngestComplete={onIngestComplete} />)

    const input = screen.getByLabelText(/database connection string/i)
    await user.type(input, 'not-a-valid-url')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not connect')
    })
    expect(onIngestComplete).not.toHaveBeenCalled()
    // The field can hold a real credential -- it's cleared on failure
    // too, not just success, matching its own "held only for this
    // request" promise.
    expect(input).toHaveValue('')
  })

  it('disables submit buttons while empty', () => {
    render(<DataSourcePane path="/repo" onIngestComplete={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^ingest$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled()
  })
})
