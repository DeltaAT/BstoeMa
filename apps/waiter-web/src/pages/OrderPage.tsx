import { useCallback, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ApiAuthError,
  ApiClientError,
  ApiConflictError,
  ApiNoActiveEventError,
  ApiNotFoundError,
  ApiValidationError,
} from '@serva/api-client'
import { useApiClient } from '../hooks/useApiClient'
import { useCart } from '../contexts/CartContext'
import type { CartLine } from '../contexts/CartContext'

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

function toOrderItems(lines: CartLine[]) {
  return lines.map((line) => ({
    menuItemId: line.item.id,
    quantity: line.qty,
    ...(line.specialRequests.trim()
      ? { specialRequests: line.specialRequests.trim() }
      : {}),
  }))
}

function errorCodeToMessage(err: unknown): string {
  if (err instanceof ApiNoActiveEventError)
    return 'Kein aktives Event. Bitte wende dich an den Administrator.'
  if (err instanceof ApiAuthError)
    return 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
  if (err instanceof ApiNotFoundError) {
    switch (err.code) {
      case 'TABLE_NOT_FOUND': return 'Dieser Tisch existiert nicht oder wurde geloescht.'
      case 'MENU_ITEM_NOT_FOUND': return 'Ein oder mehrere Artikel wurden nicht gefunden. Bitte aktualisiere das Menue.'
      default: return 'Ressource nicht gefunden.'
    }
  }
  if (err instanceof ApiConflictError) {
    switch (err.code) {
      case 'TABLE_LOCKED': return 'Dieser Tisch ist gesperrt. Bitte wende dich an den Administrator.'
      case 'MENU_ITEM_LOCKED': return 'Ein oder mehrere Artikel sind derzeit gesperrt.'
      case 'MENU_CATEGORY_LOCKED': return 'Eine oder mehrere Kategorien sind derzeit gesperrt.'
      case 'USER_LOCKED': return 'Dein Benutzerkonto ist gesperrt. Bitte wende dich an den Administrator.'
      default: return err.message
    }
  }
  if (err instanceof ApiValidationError)
    return 'Ungueltige Bestelldaten. Bitte ueberpruefe deine Bestellung.'
  if (err instanceof ApiClientError) {
    if (err.code === 'OUT_OF_STOCK') return 'Nicht genug Lagerbestand fuer einen oder mehrere Artikel.'
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'Unbekannter Fehler. Bitte versuche es erneut.'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrderPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const client = useApiClient()

  const {
    lines,
    count,
    total,
    regularCount,
    extraCount,
    setQuantity,
    removeItem,
    setSpecialRequests,
    toggleExtra,
    clearCart,
    payItems,
  } = useCart()

  const tableName =
    (location.state as { tableName?: string } | null)?.tableName ?? null

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Extras accordion open state — auto-open when extras exist
  const [extrasOpen, setExtrasOpen] = useState(false)

  // Sub-bill selection: itemId -> qty being added to sub-bill
  const [subBill, setSubBill] = useState<Record<number, number>>({})

  const lineList = Object.values(lines)
  const regularLines = lineList.filter((l) => !l.isExtra)
  const extraLines = lineList.filter((l) => l.isExtra)

  // Sub-bill derived values
  const subBillEntries = Object.entries(subBill)
    .map(([k, qty]) => ({ line: lines[Number(k)], qty }))
    .filter((e) => e.line && e.qty > 0)

  const subBillTotal = subBillEntries.reduce(
    (sum, e) => sum + e.qty * e.line.item.price,
    0,
  )
  const hasSubBill = subBillEntries.length > 0

  // Update sub-bill qty for an item (0 = remove from sub-bill)
  const setSubBillQty = useCallback((itemId: number, qty: number) => {
    setSubBill((prev) => {
      if (qty <= 0) {
        const { [itemId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [itemId]: qty }
    })
  }, [])

  // Pay the sub-bill
  const handlePay = useCallback(() => {
    const payments: Record<number, number> = {}
    for (const { line, qty } of subBillEntries) {
      payments[line.item.id] = qty
    }
    payItems(payments)
    setSubBill({})
  }, [subBillEntries, payItems])

  // ── Submit ─────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (lineList.length === 0) return
    const tableIdNum = Number(tableId)
    if (!Number.isFinite(tableIdNum) || tableIdNum <= 0) return

    setSubmitting(true)
    setSubmitError(null)

    const hasRegular = regularLines.length > 0
    const hasExtra = extraLines.length > 0

    try {
      if (hasRegular) {
        await client.orders.create({
          tableId: tableIdNum,
          items: toOrderItems(regularLines),
        })
      }

      if (hasExtra) {
        await client.orders.create({
          tableId: tableIdNum,
          items: toOrderItems(extraLines),
        })
      }

      clearCart()
      const msg =
        hasRegular && hasExtra
          ? 'Bestellung & Extras aufgegeben!'
          : hasExtra
          ? 'Extras aufgegeben!'
          : 'Bestellung aufgegeben!'
      setToastMessage(msg)
      setTimeout(() => navigate('/tables', { replace: true }), 1500)
    } catch (err) {
      setSubmitError(errorCodeToMessage(err))
      setSubmitting(false)
    }
  }, [client, lineList, regularLines, extraLines, tableId, clearCart, navigate])

  // ── Navigation ─────────────────────────────────────────────────────────

  const goBack = useCallback(() => {
    navigate(`/tables/${tableId}/menu`, { state: { tableName } })
  }, [navigate, tableId, tableName])

  // ── Header ─────────────────────────────────────────────────────────────

  const header = (
    <div className="order-page__header">
      <button
        type="button"
        className="back-button"
        onClick={goBack}
        disabled={submitting}
        aria-label="Zurueck zur Speisekarte"
      >
        <span className="back-button__icon" aria-hidden="true">&#8249;</span>
        <span>Speisekarte</span>
      </button>
      <h1 className="order-page__title">{tableName ?? `Tisch ${tableId}`}</h1>
    </div>
  )

  // ── Empty cart ─────────────────────────────────────────────────────────

  if (lineList.length === 0 && !toastMessage) {
    return (
      <div className="page order-page">
        {header}
        <p className="empty-state">Keine Artikel im Warenkorb.</p>
      </div>
    )
  }

  // ── Filled cart ────────────────────────────────────────────────────────

  return (
    <div className="page order-page">
      {toastMessage && (
        <div className="order-toast order-toast--success" role="status">
          &#10003;&nbsp;{toastMessage}
        </div>
      )}

      {header}

      {/* Regular items */}
      {regularLines.length > 0 && (
        <ul className="order-list" aria-label="Bestellung">
          {regularLines.map((line) => {
            const openQty = line.qty - line.paidQty
            const subQty = subBill[line.item.id] ?? 0
            return (
              <CartItemRow
                key={line.item.id}
                line={line}
                disabled={submitting}
                subBillQty={subQty}
                openQty={openQty}
                onSetQuantity={(qty) => setQuantity(line.item.id, qty)}
                onRemove={() => removeItem(line.item.id)}
                onSetSpecialRequests={(text) => setSpecialRequests(line.item.id, text)}
                onToggleExtra={() => {
                  toggleExtra(line.item.id)
                  setExtrasOpen(true)
                }}
                onSetSubBillQty={(qty) => setSubBillQty(line.item.id, qty)}
              />
            )
          })}
        </ul>
      )}

      {/* Extras accordion */}
      <div className="extras-accordion">
        <button
          type="button"
          className={`extras-accordion__toggle${extraLines.length > 0 ? ' extras-accordion__toggle--has-items' : ''}`}
          onClick={() => setExtrasOpen((v) => !v)}
          aria-expanded={extrasOpen}
        >
          <span className="extras-accordion__label">
            Extras
            {extraLines.length > 0 && (
              <span className="extras-accordion__count">{extraCount}</span>
            )}
          </span>
          <span className="extras-accordion__hint">separater Kuechenbon</span>
          <span className="extras-accordion__chevron" aria-hidden="true">
            {extrasOpen ? '&#8743;' : '&#8744;'}
          </span>
        </button>

        {extrasOpen && (
          <div className="extras-accordion__body">
            {extraLines.length === 0 ? (
              <p className="extras-accordion__empty">
                Noch keine Extras. Artikel als &ldquo;Extra&rdquo; markieren, um sie hier hinzuzufuegen.
              </p>
            ) : (
              <ul className="order-list order-list--extra" aria-label="Extras">
                {extraLines.map((line) => {
                  const openQty = line.qty - line.paidQty
                  const subQty = subBill[line.item.id] ?? 0
                  return (
                    <CartItemRow
                      key={line.item.id}
                      line={line}
                      disabled={submitting}
                      subBillQty={subQty}
                      openQty={openQty}
                      onSetQuantity={(qty) => setQuantity(line.item.id, qty)}
                      onRemove={() => removeItem(line.item.id)}
                      onSetSpecialRequests={(text) => setSpecialRequests(line.item.id, text)}
                      onToggleExtra={() => toggleExtra(line.item.id)}
                      onSetSubBillQty={(qty) => setSubBillQty(line.item.id, qty)}
                    />
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Sub-bill panel */}
      {hasSubBill && (
        <div className="subbill-panel" role="region" aria-label="Teilrechnung">
          <div className="subbill-panel__header">Teilrechnung</div>
          <ul className="subbill-panel__list">
            {subBillEntries.map(({ line, qty }) => (
              <li key={line.item.id} className="subbill-panel__row">
                <span className="subbill-panel__name">{qty}&times;&nbsp;{line.item.name}</span>
                <span className="subbill-panel__price">{formatPrice(qty * line.item.price)}</span>
              </li>
            ))}
          </ul>
          <div className="subbill-panel__footer">
            <span className="subbill-panel__total">{formatPrice(subBillTotal)}</span>
            <button
              type="button"
              className="subbill-panel__pay-btn"
              onClick={handlePay}
              disabled={submitting}
            >
              Bezahlen
            </button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="order-summary" aria-label="Bestellzusammenfassung">
        <div className="order-summary__breakdown">
          {regularCount > 0 && extraCount > 0 && (
            <span className="order-summary__sub">{regularCount} + {extraCount} Artikel</span>
          )}
          {(regularCount === 0 || extraCount === 0) && (
            <span className="order-summary__sub">{count} Artikel</span>
          )}
        </div>
        <span className="order-summary__total">{formatPrice(total)}</span>
      </div>

      {submitError && (
        <p className="error-message order-submit-error" role="alert">
          {submitError}
        </p>
      )}

      {/* Action row */}
      <div className="order-actions">
        <button
          type="button"
          className="btn-primary btn-place-order"
          onClick={handleSubmit}
          disabled={submitting || lineList.length === 0}
        >
          {submitting ? 'Wird gesendet…' : 'Bestellen'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cart item row
// ---------------------------------------------------------------------------

interface CartItemRowProps {
  line: CartLine
  disabled: boolean
  subBillQty: number
  openQty: number
  onSetQuantity(qty: number): void
  onRemove(): void
  onSetSpecialRequests(text: string): void
  onToggleExtra(): void
  onSetSubBillQty(qty: number): void
}

function CartItemRow({
  line,
  disabled,
  subBillQty,
  openQty,
  onSetQuantity,
  onRemove,
  onSetSpecialRequests,
  onToggleExtra,
  onSetSubBillQty,
}: CartItemRowProps) {
  const { item, qty, specialRequests, isExtra, paidQty } = line
  const lineTotal = qty * item.price

  return (
    <li className={`order-row${isExtra ? ' order-row--extra' : ''}`}>
      <div className="order-row__top">
        <div className="order-row__info">
          <div className="order-row__name-row">
            <span className="order-row__name">{item.name}</span>
            <button
              type="button"
              className={`extra-toggle${isExtra ? ' extra-toggle--active' : ''}`}
              onClick={onToggleExtra}
              disabled={disabled}
              aria-pressed={isExtra}
              aria-label={isExtra ? `${item.name} als normal markieren` : `${item.name} als Extra markieren`}
            >
              Extra
            </button>
          </div>
          <span className="order-row__line-total">{formatPrice(lineTotal)}</span>
        </div>

        <div className="order-row__controls">
          <div className="stepper" role="group" aria-label={`Anzahl ${item.name}`}>
            <button
              type="button"
              className="stepper__btn"
              onClick={() => onSetQuantity(qty - 1)}
              disabled={disabled}
              aria-label={`Eins weniger ${item.name}`}
            >
              &#8722;
            </button>
            <span className="stepper__value" aria-live="polite">{qty}</span>
            <button
              type="button"
              className="stepper__btn stepper__btn--add"
              onClick={() => onSetQuantity(qty + 1)}
              disabled={disabled}
              aria-label={`Eins mehr ${item.name}`}
            >
              +
            </button>
          </div>

          <button
            type="button"
            className="order-row__remove"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`${item.name} entfernen`}
            title="Entfernen"
          >
            &#215;
          </button>
        </div>
      </div>

      <div className="order-row__price-hint">
        {formatPrice(item.price)} / St&#252;ck
      </div>

      {/* Paid / Open badges + sub-bill stepper */}
      <div className="order-row__payment">
        <div className="order-row__payment-badges">
          {paidQty > 0 && (
            <span className="payment-badge payment-badge--paid" aria-label={`${paidQty} bezahlt`}>
              &#10003; {paidQty} bezahlt
            </span>
          )}
          {openQty > 0 && (
            <span className="payment-badge payment-badge--open" aria-label={`${openQty} offen`}>
              {openQty} offen
            </span>
          )}
          {openQty === 0 && qty > 0 && (
            <span className="payment-badge payment-badge--done" aria-label="Vollstaendig bezahlt">
              &#10003; Bezahlt
            </span>
          )}
        </div>
        {openQty > 0 && (
          <div className="subbill-stepper" role="group" aria-label={`Zur Teilrechnung: ${item.name}`}>
            <button
              type="button"
              className="stepper__btn"
              onClick={() => onSetSubBillQty(Math.max(0, subBillQty - 1))}
              disabled={disabled || subBillQty <= 0}
              aria-label="Eins weniger zur Teilrechnung"
            >
              &#8722;
            </button>
            <span className="stepper__value subbill-stepper__value">
              {subBillQty > 0 ? subBillQty : <span className="subbill-stepper__placeholder">+</span>}
            </span>
            <button
              type="button"
              className="stepper__btn stepper__btn--add"
              onClick={() => onSetSubBillQty(Math.min(openQty, subBillQty + 1))}
              disabled={disabled || subBillQty >= openQty}
              aria-label="Eins mehr zur Teilrechnung"
            >
              +
            </button>
          </div>
        )}
      </div>

      <label className="order-row__special">
        <span className="order-row__special-label">
          Sonderw&#252;nsche
          <span className="order-row__special-optional"> (optional)</span>
        </span>
        <textarea
          className="order-row__special-input"
          value={specialRequests}
          onChange={(e) => onSetSpecialRequests(e.target.value)}
          placeholder="z. B. ohne Zwiebeln, extra Sauce..."
          maxLength={500}
          rows={2}
          disabled={disabled}
          aria-label={`Sonderwuensche fuer ${item.name}`}
        />
      </label>
    </li>
  )
}
