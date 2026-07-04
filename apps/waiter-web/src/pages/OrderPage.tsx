import { useCallback, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useCart, lineUnits } from '../contexts/CartContext'
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
//
// Payment screen. By the time the waiter reaches this page the order has
// already been submitted and its bons printed on the menu screen (issue #131),
// so this page only settles the bill: it tracks which units have been paid
// (full or split "Teilrechnung") while the kitchen prepares the food in
// parallel. The cart is client-side only; leaving the page discards it.

export function OrderPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const {
    lines,
    count,
    total,
    removeItem,
    clearCart,
    payItems,
  } = useCart()

  const tableName =
    (location.state as { tableName?: string } | null)?.tableName ?? null

  // Sub-bill selection: itemId -> qty being added to sub-bill
  const [subBill, setSubBill] = useState<Record<number, number>>({})

  const lineList = Object.values(lines)

  // Sub-bill derived values — memoized so the callbacks that depend on it keep
  // stable identity (the app builds with the React Compiler).
  const subBillEntries = useMemo(
    () =>
      Object.entries(subBill)
        .map(([k, qty]) => ({ line: lines[Number(k)], qty }))
        .filter((e) => e.line && e.qty > 0),
    [subBill, lines],
  )

  const subBillTotal = subBillEntries.reduce(
    (sum, e) => sum + e.qty * e.line.item.price,
    0,
  )
  const hasSubBill = subBillEntries.length > 0

  // Update sub-bill qty for an item (0 = remove from sub-bill)
  const setSubBillQty = useCallback((itemId: number, qty: number) => {
    setSubBill((prev) => {
      if (qty <= 0) {
        const rest = { ...prev }
        delete rest[itemId]
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

  // ── Finish ─────────────────────────────────────────────────────────────
  // Done settling this table — drop the cart and return to the table list.

  const handleFinish = useCallback(() => {
    clearCart()
    navigate('/tables', { replace: true })
  }, [clearCart, navigate])

  // ── Header ─────────────────────────────────────────────────────────────

  const header = (
    <div className="order-page__header">
      <button
        type="button"
        className="back-button"
        onClick={handleFinish}
        aria-label="Zurueck zu den Tischen"
      >
        <span className="back-button__icon" aria-hidden="true">&#8249;</span>
        <span>Tische</span>
      </button>
      <h1 className="order-page__title">{tableName ?? `Tisch ${tableId}`}</h1>
    </div>
  )

  // ── Empty cart ─────────────────────────────────────────────────────────

  if (lineList.length === 0) {
    return (
      <div className="page order-page">
        {header}
        <p className="empty-state">Keine offene Rechnung fuer diesen Tisch.</p>
      </div>
    )
  }

  // ── Filled cart ────────────────────────────────────────────────────────

  return (
    <div className="page order-page">
      {header}

      {/* Cart items */}
      {lineList.length > 0 && (
        <ul className="order-list" aria-label="Bestellung">
          {lineList.map((line) => {
            const openQty = lineUnits(line) - line.paidQty
            const subQty = subBill[line.item.id] ?? 0
            return (
              <CartItemRow
                key={line.item.id}
                line={line}
                disabled={false}
                subBillQty={subQty}
                openQty={openQty}
                onRemove={() => removeItem(line.item.id)}
                onSetSubBillQty={(qty) => setSubBillQty(line.item.id, qty)}
              />
            )
          })}
        </ul>
      )}

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
            >
              Bezahlen
            </button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="order-summary" aria-label="Bestellzusammenfassung">
        <div className="order-summary__breakdown">
          <span className="order-summary__sub">{count} Artikel</span>
        </div>
        <span className="order-summary__total">{formatPrice(total)}</span>
      </div>

      {/* Action row — the order is already placed; this only ends the session. */}
      <div className="order-actions">
        <button
          type="button"
          className="btn-primary btn-place-order"
          onClick={handleFinish}
        >
          Abschliessen
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
  /** When set, the row is highlighted in red and shows an inline error message. */
  errorKind?: 'locked' | 'notFound'
  subBillQty: number
  openQty: number
  onRemove(): void
  onSetSubBillQty(qty: number): void
}

function CartItemRow({
  line,
  disabled,
  errorKind,
  subBillQty,
  openQty,
  onRemove,
  onSetSubBillQty,
}: CartItemRowProps) {
  const { item, qty, specialRequests, paidQty } = line
  const units = lineUnits(line)
  const lineTotal = units * item.price

  return (
    <li className={[
      'order-row',
      errorKind ? 'order-row--item-error' : '',
    ].filter(Boolean).join(' ')}>
      <div className="order-row__top">
        <div className="order-row__info">
          <div className="order-row__name-row">
            {qty > 0 && <span className="order-row__qty">{qty}&times;</span>}
            <span className="order-row__name">{item.name}</span>
          </div>
          <span className="order-row__line-total">{formatPrice(lineTotal)}</span>
        </div>

        <div className="order-row__controls">
          {/* Split-bill (Teilrechnung) stepper — takes the place the quantity
              stepper used to occupy. Waiters can no longer edit quantities here;
              they only choose how many units go onto the sub-bill. */}
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

      {errorKind && (
        <p className="order-row__item-error" role="alert">
          {errorKind === 'locked'
            ? 'Dieser Artikel ist nicht mehr verfügbar — bitte entfernen.'
            : 'Artikel nicht gefunden — bitte entfernen und Menü aktualisieren.'}
        </p>
      )}

      <div className="order-row__price-hint">
        {formatPrice(item.price)} / St&#252;ck
      </div>

      {/* Paid / Open badges */}
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
          {openQty === 0 && units > 0 && (
            <span className="payment-badge payment-badge--done" aria-label="Vollstaendig bezahlt">
              &#10003; Bezahlt
            </span>
          )}
        </div>
      </div>

      {specialRequests.length > 0 && (
        <ul className="sr-list sr-list--order" aria-label={`Sonderwünsche für ${item.name}`}>
          {specialRequests.map((sr, idx) => (
            <li key={idx} className="sr-list__item">
              {sr.qty > 1 && <span className="sr-list__qty">{sr.qty}&times;</span>}
              <span className="sr-list__text">{sr.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
