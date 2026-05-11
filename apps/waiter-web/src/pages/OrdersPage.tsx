import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ApiAuthError,
  ApiClientError,
  ApiConflictError,
  ApiNoActiveEventError,
  ApiNotFoundError,
  ApiValidationError,
} from '@serva/api-client'
import type {
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  TableDto,
} from '@serva/shared-types'
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

function reorderErrorMessage(err: unknown): string {
  if (err instanceof ApiNoActiveEventError)
    return 'Kein aktives Event. Bitte wende dich an den Administrator.'
  if (err instanceof ApiAuthError)
    return 'Sitzung abgelaufen. Bitte erneut anmelden.'
  if (err instanceof ApiNotFoundError) {
    if (err.code === 'TABLE_NOT_FOUND')
      return 'Tisch existiert nicht mehr.'
    if (err.code === 'MENU_ITEM_NOT_FOUND')
      return 'Artikel nicht mehr im Menü.'
    return 'Ressource nicht gefunden.'
  }
  if (err instanceof ApiConflictError) {
    if (err.code === 'TABLE_LOCKED') return 'Tisch ist gesperrt.'
    if (err.code === 'MENU_ITEM_LOCKED') return 'Artikel ist gesperrt.'
    if (err.code === 'MENU_CATEGORY_LOCKED') return 'Kategorie ist gesperrt.'
    if (err.code === 'USER_LOCKED') return 'Benutzerkonto ist gesperrt.'
    return err.message
  }
  if (err instanceof ApiValidationError) {
    const d = err.details as { insufficient?: unknown[] } | undefined
    if (Array.isArray(d?.insufficient) && d.insufficient.length > 0)
      return 'Nicht auf Lager.'
    return 'Ungültige Daten.'
  }
  if (err instanceof ApiClientError) return err.message
  if (err instanceof Error) return err.message
  return 'Nachbestellen fehlgeschlagen.'
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

// Per-item reorder state, keyed by `${orderId}:${itemId}`
type ReorderState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success' }
  | { status: 'error'; message: string }

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
  const [reorderQty, setReorderQty] = useState<Record<string, number>>({})
  const [reorderState, setReorderState] = useState<Record<string, ReorderState>>({})

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

  // ── Reorder a single item from a past order ─────────────────────────────

  const setQtyFor = useCallback((key: string, qty: number, max: number) => {
    const clamped = Math.max(1, Math.min(max, qty))
    setReorderQty((prev) => ({ ...prev, [key]: clamped }))
  }, [])

  const handleReorder = useCallback(
    async (order: OrderDto, item: OrderItemDto, qty: number) => {
      const key = `${order.id}:${item.id}`
      setReorderState((prev) => ({ ...prev, [key]: { status: 'submitting' } }))
      try {
        await client.orders.create({
          tableId: order.tableId,
          items: [
            {
              menuItemId: item.menuItemId,
              quantity: qty,
              ...(item.specialRequests
                ? { specialRequests: item.specialRequests }
                : {}),
            },
          ],
        })
        if (!liveRef.current) return
        setReorderState((prev) => ({ ...prev, [key]: { status: 'success' } }))
        void load('refresh')
      } catch (err) {
        if (!liveRef.current) return
        setReorderState((prev) => ({
          ...prev,
          [key]: { status: 'error', message: reorderErrorMessage(err) },
        }))
      }
    },
    [client, load],
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
            const summary = itemsSummary(order.items, menuItems)
            const isOpen = expandedId === order.id
            const detail = expanded[order.id]
            return (
              <OrdersRow
                key={order.id}
                order={order}
                tableName={tableName}
                qty={qty}
                summary={summary}
                isOpen={isOpen}
                detail={detail}
                menuItems={menuItems}
                reorderQty={reorderQty}
                reorderState={reorderState}
                onToggle={() => toggleExpand(order.id)}
                onSetReorderQty={setQtyFor}
                onReorder={handleReorder}
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
  summary: string
  isOpen: boolean
  detail: Expanded | undefined
  menuItems: Map<number, MenuItemDto>
  reorderQty: Record<string, number>
  reorderState: Record<string, ReorderState>
  onToggle(): void
  onSetReorderQty(key: string, qty: number, max: number): void
  onReorder(order: OrderDto, item: OrderItemDto, qty: number): void
}

function OrdersRow({
  order,
  tableName,
  qty,
  summary,
  isOpen,
  detail,
  menuItems,
  reorderQty,
  reorderState,
  onToggle,
  onSetReorderQty,
  onReorder,
}: OrdersRowProps) {
  const detailItems =
    detail?.status === 'ok' ? detail.order.items : order.items

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
            <ul className="orders-row__detail-list">
              {detailItems.map((it) => {
                const name =
                  menuItems.get(it.menuItemId)?.name ?? `#${it.menuItemId}`
                const key = `${order.id}:${it.id}`
                const max = Math.max(1, it.quantity)
                const currentQty = reorderQty[key] ?? 1
                const state: ReorderState =
                  reorderState[key] ?? { status: 'idle' }
                const submitting = state.status === 'submitting'
                return (
                  <li key={it.id} className="orders-row__detail-item">
                    <span className="orders-row__detail-qty">{it.quantity}×</span>
                    <span className="orders-row__detail-name">{name}</span>
                    {it.specialRequests && (
                      <span className="orders-row__detail-note">
                        {it.specialRequests}
                      </span>
                    )}
                    <div className="reorder-row">
                      <div
                        className="reorder-stepper"
                        role="group"
                        aria-label={`Nachbestellmenge ${name}`}
                      >
                        <button
                          type="button"
                          className="stepper__btn"
                          onClick={() =>
                            onSetReorderQty(key, currentQty - 1, max)
                          }
                          disabled={submitting || currentQty <= 1}
                          aria-label="Eins weniger"
                        >
                          −
                        </button>
                        <span className="stepper__value">{currentQty}</span>
                        <button
                          type="button"
                          className="stepper__btn stepper__btn--add"
                          onClick={() =>
                            onSetReorderQty(key, currentQty + 1, max)
                          }
                          disabled={submitting || currentQty >= max}
                          aria-label="Eins mehr"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="reorder-btn"
                        onClick={() => onReorder(order, it, currentQty)}
                        disabled={submitting}
                      >
                        {submitting ? 'Sende…' : 'Nachbestellen'}
                      </button>
                    </div>
                    {state.status === 'success' && (
                      <p
                        className="reorder-feedback reorder-feedback--success"
                        role="status"
                      >
                        ✓ Nachbestellt
                      </p>
                    )}
                    {state.status === 'error' && (
                      <p
                        className="reorder-feedback reorder-feedback--error"
                        role="alert"
                      >
                        {state.message}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
