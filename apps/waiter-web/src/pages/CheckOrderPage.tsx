import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiNotFoundError } from '@bstoema/api-client'
import { useAuth } from '@bstoema/auth-context'
import { useApiClient } from '../hooks/useApiClient'
import { useCart } from '../contexts/CartContext'
import { PrintResultModal } from '../components/PrintResultModal'
import { buildBonItemLines, formatBonTime } from '../lib/bon-preview'
import {
  errorCodeToMessage,
  runOrderPrint,
  toOrderItems,
} from '../lib/order-submit'
import type { PrintResultModalState } from '../lib/order-submit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const eurFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

function formatPrice(value: number): string {
  return eurFormatter.format(value)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
//
// Confirmation screen between the menu and the printer (issue #167). Nothing has
// been sent yet when this renders: the waiter sees a preview of the bon the
// kitchen will receive and either goes back to the menu to fix the order, or
// confirms — which is the point where the order is created and its bons printed.
//
// Submitting lives here rather than on the menu so there is exactly one place in
// the app that turns a cart into an order.

export function CheckOrderPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const client = useApiClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const { lines, count, total } = useCart()

  const tableName =
    (location.state as { tableName?: string } | null)?.tableName ?? null

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [printResult, setPrintResult] = useState<PrintResultModalState | null>(null)

  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const lineList = useMemo(() => Object.values(lines), [lines])
  const bonLines = useMemo(() => buildBonItemLines(lineList), [lineList])

  // The bon prints the time the *order* is created; until the waiter confirms,
  // showing the current clock is the closest honest approximation.
  const previewTime = formatBonTime(new Date())

  const menuPath = `/tables/${tableId}/menu`

  const handleBack = useCallback(() => {
    navigate(menuPath, { state: { tableName } })
  }, [navigate, menuPath, tableName])

  // Nothing to confirm (direct URL load, or a refresh that dropped the
  // in-memory cart) — send the waiter back to the menu.
  const isEmpty = bonLines.length === 0
  useEffect(() => {
    if (isEmpty) navigate(menuPath, { replace: true, state: { tableName } })
  }, [isEmpty, navigate, menuPath, tableName])

  // ── Confirm & print ────────────────────────────────────────────────────
  //
  // The cart is intentionally *not* cleared: the order items carry over to the
  // payment screen so the bill can be settled there (issue #131).

  const handleConfirm = useCallback(async () => {
    const tableIdNum = Number(tableId)
    if (!Number.isFinite(tableIdNum) || tableIdNum <= 0) return
    if (lineList.length === 0) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const order = await client.orders.create({
        tableId: tableIdNum,
        items: toOrderItems(lineList),
      })

      const result = await runOrderPrint(() => client.orders.print(order.id))
      if (!liveRef.current) return
      setPrintResult(result)
      setSubmitting(false)
    } catch (err) {
      if (!liveRef.current) return
      // Table vanished mid-flow — bail back to the table list.
      if (err instanceof ApiNotFoundError && err.code === 'TABLE_NOT_FOUND') {
        setSubmitError(errorCodeToMessage(err))
        setSubmitting(false)
        setTimeout(() => navigate('/tables', { replace: true }), 1500)
        return
      }
      setSubmitError(errorCodeToMessage(err))
      setSubmitting(false)
    }
  }, [client, lineList, tableId, navigate])

  // Order placed and bons printed — move on to the payment screen.
  const handleCloseResult = useCallback(() => {
    setPrintResult(null)
    navigate(`/tables/${tableId}/order`, { state: { tableName } })
  }, [navigate, tableId, tableName])

  if (isEmpty) return null

  const heading = tableName ?? `Tisch ${tableId}`

  return (
    <div className="page check-page">
      {printResult && (
        <PrintResultModal state={printResult} onClose={handleCloseResult} />
      )}

      <div className="check-page__header">
        <button
          type="button"
          className="back-button"
          onClick={handleBack}
          disabled={submitting}
          aria-label="Zurueck zur Speisekarte"
        >
          <span className="back-button__icon" aria-hidden="true">&#8249;</span>
          <span>Speisekarte</span>
        </button>
        <h1 className="check-page__title">Bestellung prüfen</h1>
        <p className="check-page__subtitle">
          So wird der Bon in der Küche gedruckt.
        </p>
      </div>

      {/* Bon preview — mirrors the layout the thermal printer produces. */}
      <div className="bon-preview" role="region" aria-label="Vorschau des Bons">
        <div className="bon-preview__paper">
          <div className="bon-preview__table">{heading}</div>
          <div className="bon-preview__rule" aria-hidden="true" />

          <div className="bon-preview__meta">
            <div>Bestellung #—</div>
            <div>Kellner: {user?.username ?? '?'}</div>
            <div>Zeit: {previewTime}</div>
          </div>
          <div className="bon-preview__rule" aria-hidden="true" />

          <ul className="bon-preview__items">
            {bonLines.map((bonLine, idx) => (
              <li key={idx} className="bon-preview__item">
                <span className="bon-preview__item-line">
                  {bonLine.qty}x {bonLine.name}
                </span>
                {bonLine.note && (
                  <span className="bon-preview__item-note">*{bonLine.note}</span>
                )}
              </li>
            ))}
          </ul>

          <div className="bon-preview__rule" aria-hidden="true" />
          <div className="bon-preview__end">Ende Bon</div>
        </div>
        <p className="bon-preview__hint">
          Bestellnummer und Uhrzeit werden beim Drucken gesetzt. Artikel
          verschiedener Kategorien können auf mehreren Druckern landen.
        </p>
      </div>

      {/* What the guest pays — the bon itself carries no prices. */}
      <div className="order-summary" aria-label="Bestellzusammenfassung">
        <div className="order-summary__breakdown">
          <span className="order-summary__sub">{count} Artikel</span>
        </div>
        <span className="order-summary__total">{formatPrice(total)}</span>
      </div>

      {submitError && (
        <p className="error-message order-submit-error" role="alert">
          {submitError}
        </p>
      )}

      <div className="order-actions">
        <button
          type="button"
          className="btn-split"
          onClick={handleBack}
          disabled={submitting}
        >
          Zurück
        </button>
        <button
          type="button"
          className="btn-primary btn-place-order"
          onClick={handleConfirm}
          disabled={submitting}
        >
          {submitting ? 'Wird gedruckt…' : 'Bestellen & drucken'}
        </button>
      </div>
    </div>
  )
}
