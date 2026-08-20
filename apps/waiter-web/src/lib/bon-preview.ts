import { lineUnits } from '../contexts/CartContext'
import type { CartLine } from '../contexts/CartContext'
import { toOrderItems } from './order-submit'

// ---------------------------------------------------------------------------
// Bon preview
// ---------------------------------------------------------------------------
//
// Reproduces the body of the kitchen bon *before* the order is sent, so the
// waiter can check it on the confirmation screen (issue #167).
//
// This deliberately runs the same encode → decode round-trip the real bon goes
// through — toOrderItems() joins a line's special requests into one "[Nx ]text"
// string separated by "; ", and the API splits that string apart again in
// `parseSpecialRequests` (apps/api/src/domain/printer-store.ts) before laying
// out the lines in `formatOrderBon`. Previewing the decoded form rather than the
// raw cart means a note that survives the round-trip badly (one containing "; ",
// say) looks wrong here too — which is the point: this shows what will actually
// print, not what we wish would print.
//
// Keep in sync with `formatOrderBon` / `parseSpecialRequests` in
// apps/api/src/domain/printer-store.ts.

export interface BonPreviewLine {
  /** Units on this line. */
  qty: number
  /** Menu item name. */
  name: string
  /** The special-request note, when this line is a noted unit. */
  note?: string
}

/** Mirror of `parseSpecialRequests` in the API's printer-store. */
function parseSpecialRequests(raw: string): Array<{ qty: number; text: string }> {
  if (!raw) return []
  const requests: Array<{ qty: number; text: string }> = []
  for (const part of raw.split('; ')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const match = /^(\d+)x (.+)$/.exec(trimmed)
    if (match) {
      requests.push({ qty: Number(match[1]), text: match[2] })
    } else {
      requests.push({ qty: 1, text: trimmed })
    }
  }
  return requests
}

/**
 * The item lines the bon will carry, in print order.
 *
 * Plain (un-noted) units print first as a single `Nx Item` line, then one line
 * per distinct special request — so the kitchen sees exactly how many of the
 * item are modified.
 */
export function buildBonItemLines(lines: CartLine[]): BonPreviewLine[] {
  const orderItems = toOrderItems(lines)
  const byId = new Map(lines.map((line) => [line.item.id, line]))
  const out: BonPreviewLine[] = []

  for (const orderItem of orderItems) {
    const line = byId.get(orderItem.menuItemId)
    if (!line) continue

    const requests = parseSpecialRequests(orderItem.specialRequests ?? '')
    const specialUnits = requests.reduce((sum, r) => sum + r.qty, 0)
    const plainQty = lineUnits(line) - specialUnits

    if (plainQty > 0) {
      out.push({ qty: plainQty, name: line.item.name })
    }
    for (const request of requests) {
      out.push({ qty: request.qty, name: line.item.name, note: request.text })
    }
  }

  return out
}

/** `HH:MM` in the device's local time — the same shape the bon prints. */
export function formatBonTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
