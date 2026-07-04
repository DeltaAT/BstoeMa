import {
  ApiAuthError,
  ApiClientError,
  ApiConflictError,
  ApiNoActiveEventError,
  ApiNotFoundError,
  ApiValidationError,
} from '@serva/api-client'
import type { OrderPrintResultDto } from '@serva/shared-types'
import { lineUnits } from '../contexts/CartContext'
import type { CartLine } from '../contexts/CartContext'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrintRunResult {
  /** Display label for which order this run covers ("Bestellung" / "Extras"). */
  label: string
  /** False when the API reports `order.printTickets` is disabled. */
  printingEnabled: boolean
  /** Per-printer results (empty when printing is disabled or the call threw). */
  results: OrderPrintResultDto[]
  /** Set when the print API call itself failed (network/server error). */
  error: string | null
}

export interface PrintResultModalState {
  title: string
  /** True when every run reports printingEnabled. */
  printingEnabled: boolean
  /** True when no run had an error and every printer result is ok/skipped/queued. */
  allOk: boolean
  runs: PrintRunResult[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toOrderItems(lines: CartLine[]) {
  return lines
    .filter((line) => line.qty > 0 || line.specialRequests.length > 0)
    .map((line) => {
      const sr = line.specialRequests
        .map((s) => (s.qty > 1 ? `${s.qty}x ${s.text}` : s.text))
        .join('; ')
        .trim()
      return {
        menuItemId: line.item.id,
        quantity: lineUnits(line),
        ...(sr ? { specialRequests: sr } : {}),
      }
    })
}

export function errorCodeToMessage(err: unknown): string {
  if (err instanceof ApiNoActiveEventError)
    return 'Kein aktives Event. Bitte wende dich an den Administrator.'
  if (err instanceof ApiAuthError)
    return 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
  if (err instanceof ApiNotFoundError) {
    switch (err.code) {
      case 'TABLE_NOT_FOUND': return 'Dieser Tisch existiert nicht oder wurde geloescht.'
      case 'MENU_ITEM_NOT_FOUND': return 'Ein oder mehrere Artikel wurden nicht gefunden — bitte den markierten Artikel entfernen und Menue aktualisieren.'
      default: return 'Ressource nicht gefunden.'
    }
  }
  if (err instanceof ApiConflictError) {
    switch (err.code) {
      case 'TABLE_LOCKED': return 'Dieser Tisch ist gesperrt. Bitte wende dich an den Administrator.'
      case 'MENU_ITEM_LOCKED': return 'Ein oder mehrere Artikel sind gesperrt — bitte den markierten Artikel entfernen.'
      case 'MENU_CATEGORY_LOCKED': return 'Eine oder mehrere Kategorien sind gesperrt — bitte den markierten Artikel entfernen.'
      case 'USER_LOCKED': return 'Dein Benutzerkonto ist gesperrt. Bitte wende dich an den Administrator.'
      default: return err.message
    }
  }
  // 422: ApiValidationError always has code UNPROCESSABLE_ENTITY; detect
  // OUT_OF_STOCK by presence of the `insufficient` array in details.
  if (err instanceof ApiValidationError) {
    const d = err.details as { insufficient?: unknown[] } | undefined
    if (Array.isArray(d?.insufficient) && d.insufficient.length > 0)
      return 'Nicht auf Lager. Bitte entferne betroffene Artikel oder wende dich an den Administrator.'
    return 'Ungueltige Bestelldaten. Bitte ueberpruefe deine Bestellung.'
  }
  if (err instanceof ApiClientError) return err.message
  if (err instanceof Error) return err.message
  return 'Unbekannter Fehler. Bitte versuche es erneut.'
}

/**
 * Runs the print request for a freshly created order and folds the outcome into
 * a modal-ready state. Never throws — a failed print call is captured as an
 * `error` run so the bon result can still be surfaced to the waiter while the
 * order itself is already persisted.
 */
export async function runOrderPrint(
  print: () => Promise<{ printingEnabled: boolean; results: OrderPrintResultDto[] }>,
): Promise<PrintResultModalState> {
  let printRun: PrintRunResult
  try {
    const res = await print()
    printRun = {
      label: 'Bestellung',
      printingEnabled: res.printingEnabled,
      results: res.results,
      error: null,
    }
  } catch (err) {
    printRun = {
      label: 'Bestellung',
      printingEnabled: true,
      results: [],
      error: err instanceof Error ? err.message : 'Druckauftrag fehlgeschlagen.',
    }
  }

  const allOk =
    printRun.error === null &&
    printRun.results.every((it) => it.status !== 'error')

  return {
    title: 'Bestellung aufgegeben',
    printingEnabled: printRun.printingEnabled,
    allOk,
    runs: [printRun],
  }
}
