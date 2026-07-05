import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type {
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  TableDto,
} from '@bstoema/shared-types'
import { useApiClient } from '../hooks/useApiClient'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timeFormatter = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
})

const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
})

const eurFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

function formatPrice(value: number): string {
  return eurFormatter.format(value)
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function formatTimestamp(iso: string): string {
  return isToday(iso)
    ? timeFormatter.format(new Date(iso))
    : `${dayFormatter.format(new Date(iso))} ${timeFormatter.format(new Date(iso))}`
}

function totalQty(items: OrderItemDto[]): number {
  return items.reduce((sum, it) => sum + it.quantity, 0)
}

/** Sum of all line totals, priced from the current menu. */
function orderTotal(
  items: OrderItemDto[],
  menuItems: Map<number, MenuItemDto>,
): number {
  return items.reduce((sum, it) => {
    const price = menuItems.get(it.menuItemId)?.price ?? 0
    return sum + price * it.quantity
  }, 0)
}

function itemsSummary(
  items: OrderItemDto[],
  menuItems: Map<number, MenuItemDto>,
): string {
  const parts = items.map((it) => {
    const name = menuItems.get(it.menuItemId)?.name ?? `#${it.menuItemId}`
    return `${it.quantity}× ${name}`
  })
  if (parts.length <= 3) return parts.join(', ')
  return `${parts.slice(0, 3).join(', ')} …`
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ok'
      orders: OrderDto[]
      tables: Map<number, TableDto>
      menuItems: Map<number, MenuItemDto>
    }

// Per-order expansion fetch
type Expanded =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; order: OrderDto }

// Pull-to-refresh tuning
const PTR_TRIGGER_PX = 70
const PTR_MAX_PX = 110

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrdersPage() {
  const client = useApiClient()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<number, Expanded>>({})

  const liveRef = useRef(true)

  // ── Load orders + lookups in parallel ───────────────────────────────────

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setState({ status: 'loading' })
      else setRefreshing(true)

      try {
        const [ordersRes, tablesRes, menuItemsRes] = await Promise.all([
          client.orders.list(),
          client.tables.list(),
          client.menu.listItems(),
        ])

        const orders = [...ordersRes.orders].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp),
        )
        const tables = new Map(tablesRes.tables.map((t) => [t.id, t]))
        const menuItems = new Map(menuItemsRes.items.map((m) => [m.id, m]))

        if (liveRef.current) {
          setState({ status: 'ok', orders, tables, menuItems })
          // Drop any cached expansions — names may have changed.
          setExpanded({})
        }
      } catch (err) {
        if (liveRef.current) {
          setState({
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Unbekannter Fehler beim Laden der Bestellungen.',
          })
        }
      } finally {
        if (liveRef.current) setRefreshing(false)
      }
    },
    [client],
  )

  useEffect(() => {
    liveRef.current = true
    load('initial')
    return () => {
      liveRef.current = false
    }
  }, [load])

  // ── Expand row → fetch /orders/:id ──────────────────────────────────────

  const toggleExpand = useCallback(
    async (orderId: number) => {
      if (expandedId === orderId) {
        setExpandedId(null)
        return
      }
      setExpandedId(orderId)
      if (expanded[orderId]?.status === 'ok') return

      setExpanded((prev) => ({ ...prev, [orderId]: { status: 'loading' } }))
      try {
        const order = await client.orders.getById(orderId)
        if (!liveRef.current) return
        setExpanded((prev) => ({ ...prev, [orderId]: { status: 'ok', order } }))
      } catch (err) {
        if (!liveRef.current) return
        setExpanded((prev) => ({
          ...prev,
          [orderId]: {
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Bestelldetails konnten nicht geladen werden.',
          },
        }))
      }
    },
    [client, expanded, expandedId],
  )

  // ── Pull-to-refresh ─────────────────────────────────────────────────────

  const pageRef = useRef<HTMLDivElement | null>(null)
  const ptrStartY = useRef<number | null>(null)
  const [ptrDistance, setPtrDistance] = useState(0)

  const getScrollContainer = (): HTMLElement | null => {
    let el: HTMLElement | null = pageRef.current
    while (el) {
      if (el.classList?.contains('layout-main')) return el
      el = el.parentElement
    }
    return null
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (refreshing) return
    if (e.pointerType !== 'touch') return
    const scroller = getScrollContainer()
    if (!scroller || scroller.scrollTop > 0) return
    ptrStartY.current = e.clientY
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (ptrStartY.current == null) return
    const dy = e.clientY - ptrStartY.current
    if (dy <= 0) {
      setPtrDistance(0)
      return
    }
    // Damped pull so it feels rubbery.
    const damped = Math.min(PTR_MAX_PX, dy * 0.5)
    setPtrDistance(damped)
  }

  const finishPtr = useCallback(() => {
    if (ptrStartY.current == null) return
    const trigger = ptrDistance >= PTR_TRIGGER_PX
    ptrStartY.current = null
    setPtrDistance(0)
    if (trigger && !refreshing) {
      void load('refresh')
    }
  }, [load, ptrDistance, refreshing])

  const onPointerUp = () => finishPtr()
  const onPointerCancel = () => finishPtr()

  // ── Derived: indicator shows "release" hint past the trigger threshold ──
  const ptrActive = ptrDistance > 0 || refreshing
  const ptrReady = ptrDistance >= PTR_TRIGGER_PX

  // ── Renders ─────────────────────────────────────────────────────────────

  const ptrIndicator = ptrActive && (
    <div
      className="ptr-indicator"
      style={{
        height: refreshing ? PTR_TRIGGER_PX : ptrDistance,
      }}
      aria-hidden="true"
    >
      <span className={`ptr-indicator__label${ptrReady && !refreshing ? ' ptr-indicator__label--ready' : ''}`}>
        {refreshing
          ? 'Aktualisiere…'
          : ptrReady
            ? 'Loslassen zum Aktualisieren'
            : 'Zum Aktualisieren ziehen'}
      </span>
    </div>
  )

  if (state.status === 'loading') {
    return (
      <div className="page orders-page" ref={pageRef}>
        <h2>Meine Bestellungen</h2>
        <ul className="orders-list" aria-busy="true" aria-label="Bestellungen werden geladen">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="orders-row orders-row--skeleton" aria-hidden="true" />
          ))}
        </ul>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page orders-page orders-feedback" ref={pageRef}>
        <h2>Meine Bestellungen</h2>
        <p className="error-message">{state.message}</p>
        <button
          type="button"
          className="btn-primary btn-retry"
          onClick={() => load('initial')}
        >
          Erneut versuchen
        </button>
      </div>
    )
  }

  const { orders, tables, menuItems } = state

  return (
    <div
      className="page orders-page"
      ref={pageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="orders-page__header">
        <h2>Meine Bestellungen</h2>
        <button
          type="button"
          className="orders-page__refresh"
          onClick={() => load('refresh')}
          disabled={refreshing}
          aria-label="Aktualisieren"
        >
          {refreshing ? 'Aktualisiere…' : 'Aktualisieren'}
        </button>
      </div>

      {ptrIndicator}

      {orders.length === 0 ? (
        <p className="empty-state">Noch keine Bestellungen aufgegeben.</p>
      ) : (
        <ul className="orders-list">
          {orders.map((order) => {
            const tableName =
              tables.get(order.tableId)?.name ?? `Tisch ${order.tableId}`
            const qty = totalQty(order.items)
            const total = orderTotal(order.items, menuItems)
            const summary = itemsSummary(order.items, menuItems)
            const isOpen = expandedId === order.id
            const detail = expanded[order.id]
            return (
              <OrdersRow
                key={order.id}
                order={order}
                tableName={tableName}
                qty={qty}
                total={total}
                summary={summary}
                isOpen={isOpen}
                detail={detail}
                menuItems={menuItems}
                onToggle={() => toggleExpand(order.id)}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface OrdersRowProps {
  order: OrderDto
  tableName: string
  qty: number
  total: number
  summary: string
  isOpen: boolean
  detail: Expanded | undefined
  menuItems: Map<number, MenuItemDto>
  onToggle(): void
}

function OrdersRow({
  order,
  tableName,
  qty,
  total,
  summary,
  isOpen,
  detail,
  menuItems,
  onToggle,
}: OrdersRowProps) {
  const detailItems =
    detail?.status === 'ok' ? detail.order.items : order.items
  const detailTotal = orderTotal(detailItems, menuItems)

  return (
    <li className={`orders-row${isOpen ? ' orders-row--open' : ''}`}>
      <button
        type="button"
        className="orders-row__summary"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="orders-row__head">
          <span className="orders-row__time">{formatTimestamp(order.timestamp)}</span>
          <span className="orders-row__table">{tableName}</span>
          <span className="orders-row__count">{qty} Artikel</span>
        </div>
        <div className="orders-row__items">{summary}</div>
        <div className="orders-row__total">
          <span className="orders-row__total-label">Gesamt</span>
          <span className="orders-row__total-value">{formatPrice(total)}</span>
        </div>
        <span className="orders-row__chevron" aria-hidden="true">
          {isOpen ? '∧' : '∨'}
        </span>
      </button>

      {isOpen && (
        <div className="orders-row__detail">
          {detail?.status === 'loading' && (
            <p className="orders-row__detail-loading">Details werden geladen…</p>
          )}
          {detail?.status === 'error' && (
            <p className="error-message">{detail.message}</p>
          )}
          {(detail?.status === 'ok' || detail === undefined) && (
            <table className="bill-table">
              <thead>
                <tr>
                  <th scope="col" className="bill-table__name-col">Artikel</th>
                  <th scope="col" className="bill-table__num-col">Anzahl</th>
                  <th scope="col" className="bill-table__num-col">Einzelpreis</th>
                  <th scope="col" className="bill-table__num-col">Summe</th>
                </tr>
              </thead>
              <tbody>
                {detailItems.map((it) => {
                  const menuItem = menuItems.get(it.menuItemId)
                  const name = menuItem?.name ?? `#${it.menuItemId}`
                  const unitPrice = menuItem?.price
                  const lineTotal =
                    unitPrice == null ? null : unitPrice * it.quantity
                  return (
                    <tr key={it.id} className="bill-table__row">
                      <td className="bill-table__name">
                        {name}
                        {it.specialRequests && (
                          <span className="bill-table__note">
                            {it.specialRequests}
                          </span>
                        )}
                      </td>
                      <td className="bill-table__num">{it.quantity}</td>
                      <td className="bill-table__num">
                        {unitPrice == null ? '—' : formatPrice(unitPrice)}
                      </td>
                      <td className="bill-table__num">
                        {lineTotal == null ? '—' : formatPrice(lineTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bill-table__total-row">
                  <th scope="row" colSpan={3} className="bill-table__total-label">
                    Gesamtbetrag
                  </th>
                  <td className="bill-table__total-value">
                    {formatPrice(detailTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </li>
  )
}
