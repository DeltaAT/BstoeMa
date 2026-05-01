import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TableDto } from '@serva/shared-types'
import { useApiClient } from '../hooks/useApiClient'

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; tables: TableDto[] }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TablesPage() {
  const client = useApiClient()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ status: 'loading' })

  // Track whether this mount is still live so we can ignore stale responses.
  const liveRef = useRef(true)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const { tables } = await client.tables.list({
        locked: false,
        sort: 'weight,name',
      })
      if (liveRef.current) {
        setState({ status: 'ok', tables })
      }
    } catch (err) {
      if (liveRef.current) {
        setState({
          status: 'error',
          message:
            err instanceof Error ? err.message : 'Unbekannter Fehler.',
        })
      }
    }
  }, [client])

  useEffect(() => {
    liveRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fetch on mount; load() owns the loading state transition
    load()
    return () => {
      liveRef.current = false
    }
  }, [load])

  // ── Loading skeleton ────────────────────────────────────────────────────

  if (state.status === 'loading') {
    return (
      <div className="page">
        <h2>Tische</h2>
        <div className="tables-grid" aria-busy="true" aria-label="Tische werden geladen">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="table-card table-card--skeleton" aria-hidden="true" />
          ))}
        </div>
      </div>
    )
  }

  // ── Error state ─────────────────────────────────────────────────────────

  if (state.status === 'error') {
    return (
      <div className="page tables-feedback">
        <h2>Tische</h2>
        <p className="error-message">{state.message}</p>
        <button className="btn-primary btn-retry" onClick={load}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  // ── Empty state ─────────────────────────────────────────────────────────

  if (state.tables.length === 0) {
    return (
      <div className="page tables-feedback">
        <h2>Tische</h2>
        <p className="empty-state">
          Noch keine Tische vorhanden. Bitte einen Admin, Tische anzulegen.
        </p>
      </div>
    )
  }

  // ── Table grid ──────────────────────────────────────────────────────────

  return (
    <div className="page">
      <h2>Tische</h2>
      <div className="tables-grid" role="list">
        {state.tables.map((table) => (
          <button
            key={table.id}
            role="listitem"
            className="table-card"
            onClick={() =>
              navigate(`/tables/${table.id}/menu`, {
                state: { tableName: table.name },
              })
            }
          >
            {table.name}
          </button>
        ))}
      </div>
    </div>
  )
}

