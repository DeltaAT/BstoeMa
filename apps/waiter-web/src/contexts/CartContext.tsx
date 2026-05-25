import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { MenuItemDto } from '@serva/shared-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecialRequest {
  id: string
  text: string
}

export interface CartLine {
  item: MenuItemDto
  qty: number
  /** When true this line is submitted as a separate "extra" order so the
   *  kitchen receives it distinctly from the main order. */
  isExtra: boolean
  /** How many units of this item have already been paid. Updated via payItems(). */
  paidQty: number
}

interface CartState {
  tableId: number | null
  lines: Record<number, CartLine>
  specialRequests: SpecialRequest[]
}

interface CartContextValue {
  tableId: number | null
  lines: Record<number, CartLine>
  specialRequests: SpecialRequest[]
  /** Total item count across all lines (sum of quantities). */
  count: number
  /** Grand total in currency units. */
  total: number
  /** Count of items not flagged as extras. */
  regularCount: number
  /** Count of extra items. */
  extraCount: number

  // ── Cart lifecycle ──────────────────────────────────────────────────────
  /**
   * Call when entering a table's menu. Wipes lines when the
   * tableId differs from the currently stored one.
   */
  initForTable(tableId: number): void
  /** Empties everything. Called on successful order and logout. */
  clearCart(): void

  // ── Line mutations ──────────────────────────────────────────────────────
  /** Adds one unit (creates line at qty=1 with isExtra=false if new). */
  addItem(item: MenuItemDto): void
  /** Decrements qty by 1; removes line at 0. */
  decrementItem(itemId: number): void
  /** Removes line entirely. */
  removeItem(itemId: number): void
  /** Sets qty directly; removes line at qty <= 0. */
  setQuantity(itemId: number, qty: number): void
  /** Toggles the isExtra flag. */
  toggleExtra(itemId: number): void

  // ── Special requests ────────────────────────────────────────────────────
  addSpecialRequest(text: string): void
  removeSpecialRequest(id: string): void

  // ── Payment tracking ────────────────────────────────────────────────────
  /**
   * Record partial or full payment for the given items.
   * payments: { itemId: unitsBeingPaid }
   * paidQty is incremented (capped at line.qty).
   */
  payItems(payments: Record<number, number>): void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const CartContext = createContext<CartContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const EMPTY_CART: CartState = {
  tableId: null,
  lines: {},
  specialRequests: [],
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART)

  // ── Lifecycle ─────────────────────────────────────────────────────────

  const initForTable = useCallback((newTableId: number) => {
    setCart((prev) => {
      if (prev.tableId === newTableId) return prev
      return { ...EMPTY_CART, tableId: newTableId }
    })
  }, [])

  const clearCart = useCallback(() => setCart(EMPTY_CART), [])

  // ── Line mutations ─────────────────────────────────────────────────────

  const addItem = useCallback((item: MenuItemDto) => {
    setCart((prev) => {
      const existing = prev.lines[item.id]
      return {
        ...prev,
        lines: {
          ...prev.lines,
          [item.id]: {
            item,
            qty: (existing?.qty ?? 0) + 1,
            isExtra: existing?.isExtra ?? false,
            paidQty: existing?.paidQty ?? 0,
          },
        },
      }
    })
  }, [])

  const decrementItem = useCallback((itemId: number) => {
    setCart((prev) => {
      const existing = prev.lines[itemId]
      if (!existing) return prev
      if (existing.qty <= 1) {
        const { [itemId]: _l, ...restLines } = prev.lines
        return { ...prev, lines: restLines }
      }
      return {
        ...prev,
        lines: { ...prev.lines, [itemId]: { ...existing, qty: existing.qty - 1 } },
      }
    })
  }, [])

  const removeItem = useCallback((itemId: number) => {
    setCart((prev) => {
      if (!prev.lines[itemId]) return prev
      const { [itemId]: _l, ...restLines } = prev.lines
      return { ...prev, lines: restLines }
    })
  }, [])

  const setQuantity = useCallback((itemId: number, qty: number) => {
    setCart((prev) => {
      const existing = prev.lines[itemId]
      if (!existing) return prev
      if (qty <= 0) {
        const { [itemId]: _l, ...restLines } = prev.lines
        return { ...prev, lines: restLines }
      }
      return { ...prev, lines: { ...prev.lines, [itemId]: { ...existing, qty } } }
    })
  }, [])

  const addSpecialRequest = useCallback((text: string) => {
    setCart((prev) => ({
      ...prev,
      specialRequests: [
        ...prev.specialRequests,
        { id: crypto.randomUUID(), text },
      ],
    }))
  }, [])

  const removeSpecialRequest = useCallback((id: string) => {
    setCart((prev) => ({
      ...prev,
      specialRequests: prev.specialRequests.filter((sr) => sr.id !== id),
    }))
  }, [])

  const toggleExtra = useCallback((itemId: number) => {
    setCart((prev) => {
      const existing = prev.lines[itemId]
      if (!existing) return prev
      return {
        ...prev,
        lines: { ...prev.lines, [itemId]: { ...existing, isExtra: !existing.isExtra } },
      }
    })
  }, [])

  // ── Payment tracking ───────────────────────────────────────────────────

  const payItems = useCallback((payments: Record<number, number>) => {
    setCart((prev) => {
      const updatedLines = { ...prev.lines }
      for (const [key, units] of Object.entries(payments)) {
        const itemId = Number(key)
        const line = updatedLines[itemId]
        if (!line || units <= 0) continue
        const newPaid = Math.min(line.paidQty + units, line.qty)
        updatedLines[itemId] = { ...line, paidQty: newPaid }
      }
      return { ...prev, lines: updatedLines }
    })
  }, [])

  // ── Derived values ──────────────────────────────────────────────────────

  const { count, total, regularCount, extraCount } = useMemo(() => {
    let c = 0, t = 0, r = 0, e = 0
    for (const line of Object.values(cart.lines)) {
      c += line.qty
      t += line.qty * line.item.price
      if (line.isExtra) e += line.qty
      else r += line.qty
    }
    return { count: c, total: t, regularCount: r, extraCount: e }
  }, [cart.lines])

  const value: CartContextValue = {
    tableId: cart.tableId,
    lines: cart.lines,
    specialRequests: cart.specialRequests,
    count,
    total,
    regularCount,
    extraCount,
    initForTable,
    clearCart,
    addItem,
    decrementItem,
    removeItem,
    setQuantity,
    toggleExtra,
    addSpecialRequest,
    removeSpecialRequest,
    payItems,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be called inside <CartProvider>')
  return ctx
}
