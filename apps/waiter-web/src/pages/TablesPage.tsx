import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TableQrResolveRequestSchema,
  type TableDto,
} from '@bstoema/shared-types'
import { useApiClient } from '../hooks/useApiClient'
import { QrScanModal } from '../components/QrScanModal'

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; tables: TableDto[] }

// QR payload printed by `GET /tables/qr.pdf` — see apps/api/src/routes/tables.ts.
type QrPayload = { tableId: number; tableName?: string }

function parseQrPayload(qrValue: string): QrPayload | null {
  // Wrap in the shared schema so the contract is enforced even though
  // resolution currently happens client-side.
  const wrapped = TableQrResolveRequestSchema.safeParse({ qrValue })
  if (!wrapped.success) return null
  let raw: unknown
  try {
    raw = JSON.parse(wrapped.data.qrValue)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const tableId = (raw as { tableId?: unknown }).tableId
  const tableName = (raw as { tableName?: unknown }).tableName
  if (typeof tableId !== 'number' || !Number.isInteger(tableId) || tableId <= 0) {
    return null
  }
  return {
    tableId,
    tableName: typeof tableName === 'string' ? tableName : undefined,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TablesPage() {
  const client = useApiClient()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanNotice, setScanNotice] = useState<string | null>(null)

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

  // ── QR handlers ─────────────────────────────────────────────────────────

  const openScanner = () => {
    setScanNotice(null)
    setScannerOpen(true)
  }

  const handleScan = (qrValue: string) => {
    const payload = parseQrPayload(qrValue)
    if (!payload) {
      setScannerOpen(false)
      setScanNotice('QR-Code konnte nicht gelesen werden. Bitte erneut versuchen oder Tisch aus der Liste wählen.')
      return
    }
    const known =
      state.status === 'ok'
        ? state.tables.find((t) => t.id === payload.tableId)
        : undefined
    const tableName = known?.name ?? payload.tableName
    setScannerOpen(false)
    setScanNotice(null)
    navigate(
      `/tables/${payload.tableId}/menu`,
      tableName ? { state: { tableName } } : undefined,
    )
  }

  const handlePermissionDenied = () => {
    setScannerOpen(false)
    setScanNotice('Kamerazugriff verweigert – bitte einen Tisch aus der Liste wählen.')
  }

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
      <button type="button" className="btn-scan" onClick={openScanner}>
        <svg
          className="btn-scan__icon"
          viewBox="0 0 24 24"
          width="28"
          height="28"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm11-2h2v2h-2v-2zm3 0h2v2h-2v-2zm-3 3h2v2h-2v-2zm3 0h2v2h-2v-2zm-3 3h2v2h-2v-2zm3 0h2v2h-2v-2zm-5-3h2v2h-2v-2zm0 3h2v2h-2v-2zm0-6h2v2h-2v-2z"
          />
        </svg>
        <span className="btn-scan__text">
          <span className="btn-scan__label">QR-Code scannen</span>
          <span className="btn-scan__sub">Tisch direkt öffnen</span>
        </span>
      </button>
      {scanNotice && <p className="tables-page__notice">{scanNotice}</p>}
      <div className="tables-page__divider" role="separator">
        <span>oder Tisch wählen</span>
      </div>
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

      {scannerOpen && (
        <QrScanModal
          onScan={handleScan}
          onClose={() => setScannerOpen(false)}
          onPermissionDenied={handlePermissionDenied}
        />
      )}
    </div>
  )
}

