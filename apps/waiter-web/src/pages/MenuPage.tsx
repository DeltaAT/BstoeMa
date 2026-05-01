import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { MenuCategoryDto, MenuItemDto } from '@serva/shared-types'
import { useApiClient } from '../hooks/useApiClient'
import { useCart } from '../contexts/CartContext'
import type { CartLine } from '../contexts/CartContext'

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type CategoriesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; categories: MenuCategoryDto[] }

type ItemsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; items: MenuItemDto[] }

// Stable EUR formatter for the locale
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

export function MenuPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const client = useApiClient()
  const navigate = useNavigate()
  const location = useLocation()

  // Cart state lives in context so it survives navigation between menu ↔ order.
  const { lines, count, total, addItem, decrementItem, initForTable } = useCart()

  // Prefer a name passed via navigation state (the common path from TablesPage).
  // Fall back to a tables.list() lookup if the user landed on this URL directly
  // (e.g. refresh, deep link).
  const stateTableName =
    (location.state as { tableName?: string } | null)?.tableName ?? null
  const [tableName, setTableName] = useState<string | null>(stateTableName)

  const [categoriesState, setCategoriesState] = useState<CategoriesState>({
    status: 'loading',
  })
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null)
  const [itemsState, setItemsState] = useState<ItemsState>({ status: 'loading' })

  // Initialise (or retain) the cart for this table. If the waiter navigates to
  // a different table, the context will wipe the lines automatically.
  useEffect(() => {
    const num = Number(tableId)
    if (Number.isFinite(num) && num > 0) initForTable(num)
  }, [tableId, initForTable])

  // Track liveness so unmounted updates don't fire setState.
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  // ── Load categories ────────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    setCategoriesState({ status: 'loading' })
    try {
      const { categories } = await client.menu.listCategories({ locked: false })
      if (!liveRef.current) return

      // Sort visually by weight then name so the tab strip is deterministic.
      const sorted = [...categories].sort(
        (a, b) => a.weight - b.weight || a.name.localeCompare(b.name),
      )

      setCategoriesState({ status: 'ok', categories: sorted })
      setActiveCategoryId((prev) => prev ?? sorted[0]?.id ?? null)
    } catch (err) {
      if (liveRef.current) {
        setCategoriesState({
          status: 'error',
          message:
            err instanceof Error ? err.message : 'Unbekannter Fehler.',
        })
      }
    }
  }, [client])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fetch on mount; loadCategories owns the loading state transition
    loadCategories()
  }, [loadCategories])

  // ── Load items for the active category ────────────────────────────────
  //
  // A monotonically increasing request id lets us ignore responses that
  // arrive out of order — e.g. when the user taps tab A then tab B before
  // A's request has resolved.

  const itemsRequestId = useRef(0)

  const loadItems = useCallback(
    (categoryId: number) => {
      const requestId = ++itemsRequestId.current
      setItemsState({ status: 'loading' })

      client.menu
        .listItems({
          categoryId,
          locked: false,
          sort: 'weight,name',
        })
        .then(({ items }) => {
          if (!liveRef.current || requestId !== itemsRequestId.current) return
          setItemsState({ status: 'ok', items })
        })
        .catch((err: unknown) => {
          if (!liveRef.current || requestId !== itemsRequestId.current) return
          setItemsState({
            status: 'error',
            message:
              err instanceof Error ? err.message : 'Unbekannter Fehler.',
          })
        })
    },
    [client],
  )

  useEffect(() => {
    if (activeCategoryId == null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-fetch when the active category changes; loadItems owns the loading state transition
    loadItems(activeCategoryId)
  }, [activeCategoryId, loadItems])

  // ── Fall back to fetching the table name on direct URL loads ──────────

  useEffect(() => {
    if (tableName != null) return
    if (tableId == null) return
    const id = Number(tableId)
    if (!Number.isFinite(id)) return

    let cancelled = false
    client.tables
      .list()
      .then(({ tables }) => {
        if (cancelled || !liveRef.current) return
        const match = tables.find((t) => t.id === id)
        if (match) setTableName(match.name)
      })
      .catch(() => {
        // Silent fallback — heading will use the numeric id below.
      })
    return () => {
      cancelled = true
    }
  }, [client, tableId, tableName])

  // ── Cart helpers (delegate to context) ────────────────────────────────

  const addToCart = useCallback((item: MenuItemDto) => addItem(item), [addItem])
  const removeFromCart = useCallback(
    (item: MenuItemDto) => decrementItem(item.id),
    [decrementItem],
  )

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="page menu-page">
      <div className="menu-page__header">
        <button
          type="button"
          className="back-button"
          onClick={() => navigate('/tables')}
          aria-label="Zurück zu den Tischen"
        >
          <span className="back-button__icon" aria-hidden="true">‹</span>
          <span>Zurück</span>
        </button>
        <h1 className="menu-page__title">
          {tableName ?? `Tisch ${tableId}`}
        </h1>
      </div>

      <CategoryTabs
        state={categoriesState}
        activeCategoryId={activeCategoryId}
        onSelect={setActiveCategoryId}
        onRetry={loadCategories}
      />

      <ItemsList
        state={itemsState}
        activeCategoryId={activeCategoryId}
        cart={lines}
        onAdd={addToCart}
        onRemove={removeFromCart}
        onRetry={() => {
          if (activeCategoryId != null) loadItems(activeCategoryId)
        }}
      />

      {count > 0 && (
        <button
          type="button"
          className="next-cta"
          onClick={() =>
            navigate(`/tables/${tableId}/order`, { state: { tableName } })
          }
        >
          <span className="next-cta__info">
            <span className="next-cta__count" aria-label="Anzahl Artikel">
              {count} Artikel
            </span>
            <span className="next-cta__sep" aria-hidden="true">
              ·
            </span>
            <span className="next-cta__total">
              {formatPrice(total)}
            </span>
          </span>
          <span className="next-cta__action">
            Weiter
            <span className="next-cta__arrow" aria-hidden="true">
              →
            </span>
          </span>
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category tab strip
// ---------------------------------------------------------------------------

interface CategoryTabsProps {
  state: CategoriesState
  activeCategoryId: number | null
  onSelect: (categoryId: number) => void
  onRetry: () => void
}

function CategoryTabs({
  state,
  activeCategoryId,
  onSelect,
  onRetry,
}: CategoryTabsProps) {
  if (state.status === 'loading') {
    return (
      <div
        className="category-tabs category-tabs--skeleton"
        aria-busy="true"
        aria-label="Kategorien werden geladen"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="category-tab category-tab--skeleton" />
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="menu-feedback">
        <p className="error-message">{state.message}</p>
        <button className="btn-primary btn-retry" onClick={onRetry}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  if (state.categories.length === 0) {
    return (
      <p className="empty-state">
        Keine Kategorien verfügbar.
      </p>
    )
  }

  return (
    <div
      className="category-tabs"
      role="tablist"
      aria-label="Kategorien"
    >
      {state.categories.map((category) => {
        const active = category.id === activeCategoryId
        return (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`category-tab${active ? ' category-tab--active' : ''}`}
            onClick={() => onSelect(category.id)}
          >
            {category.name}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Items list (stackable rows with +/- steppers)
// ---------------------------------------------------------------------------

interface ItemsListProps {
  state: ItemsState
  activeCategoryId: number | null
  cart: Record<number, CartLine>
  onAdd: (item: MenuItemDto) => void
  onRemove: (item: MenuItemDto) => void
  onRetry: () => void
}

function ItemsList({
  state,
  activeCategoryId,
  cart,
  onAdd,
  onRemove,
  onRetry,
}: ItemsListProps) {
  if (activeCategoryId == null) {
    // Categories are still loading or empty — nothing to show in the body.
    return null
  }

  if (state.status === 'loading') {
    return (
      <ul
        className="menu-list"
        aria-busy="true"
        aria-label="Artikel werden geladen"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <li
            key={i}
            className="menu-row menu-row--skeleton"
            aria-hidden="true"
          />
        ))}
      </ul>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="menu-feedback">
        <p className="error-message">{state.message}</p>
        <button className="btn-primary btn-retry" onClick={onRetry}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  if (state.items.length === 0) {
    return (
      <p className="empty-state">
        Keine Artikel in dieser Kategorie.
      </p>
    )
  }

  return (
    <ul className="menu-list" aria-label="Artikel">
      {state.items.map((item) => {
        const qty = cart[item.id]?.qty ?? 0
        const inCart = qty > 0
        return (
          <li
            key={item.id}
            className={`menu-row${inCart ? ' menu-row--in-cart' : ''}`}
          >
            <div className="menu-row__main">
              <span className="menu-row__name">{item.name}</span>
              {item.description && (
                <span className="menu-row__description">{item.description}</span>
              )}
              <span className="menu-row__price">{formatPrice(item.price)}</span>
            </div>

            <div
              className="stepper"
              role="group"
              aria-label={`Anzahl ${item.name}`}
            >
              <button
                type="button"
                className="stepper__btn"
                onClick={() => onRemove(item)}
                disabled={qty === 0}
                aria-label={`Eins weniger ${item.name}`}
              >
                −
              </button>
              <span className="stepper__value" aria-live="polite">
                {qty}
              </span>
              <button
                type="button"
                className="stepper__btn stepper__btn--add"
                onClick={() => onAdd(item)}
                aria-label={`Eins mehr ${item.name}`}
              >
                +
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
