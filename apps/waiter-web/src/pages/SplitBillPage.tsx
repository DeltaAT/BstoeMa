import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useCart } from '../contexts/CartContext'

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

const PARTY_COLORS = [
  '#3b6bff', // blue
  '#e67e22', // orange
  '#27ae60', // green
  '#9b59b6', // purple
  '#e74c3c', // red
  '#16a085', // teal
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SplitBillPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const {
    lines,
    splitCount,
    splitAssignments,
    setSplitCount,
    assignToParty,
    clearSplitAssignments,
  } = useCart()

  const tableName =
    (location.state as { tableName?: string } | null)?.tableName ?? null

  const lineList = useMemo(() => Object.values(lines), [lines])

  // Per-party totals
  const partyTotals = useMemo(() => {
    const totals: Record<number, number> = {}
    let unassigned = 0
    for (const line of lineList) {
      const party = splitAssignments[line.item.id] ?? 0
      const amount = line.qty * line.item.price
      if (party === 0) {
        unassigned += amount
      } else {
        totals[party] = (totals[party] ?? 0) + amount
      }
    }
    return { totals, unassigned }
  }, [lineList, splitAssignments])

  // Items grouped by party (for the summary panel)
  const partyItems = useMemo(() => {
    const groups: Record<number, typeof lineList> = {}
    const unassigned: typeof lineList = []
    for (const line of lineList) {
      const party = splitAssignments[line.item.id] ?? 0
      if (party === 0) {
        unassigned.push(line)
      } else {
        groups[party] = [...(groups[party] ?? []), line]
      }
    }
    return { groups, unassigned }
  }, [lineList, splitAssignments])

  const handleAssign = useCallback(
    (itemId: number, partyIndex: number, currentParty: number) => {
      // Tapping the same party again unassigns.
      assignToParty(itemId, currentParty === partyIndex ? 0 : partyIndex)
    },
    [assignToParty],
  )

  const goBack = useCallback(() => {
    navigate(`/tables/${tableId}/order`, { state: { tableName } })
  }, [navigate, tableId, tableName])

  // ── Empty cart guard ────────────────────────────────────────────────────

  if (lineList.length === 0) {
    return (
      <div className="page split-page">
        <div className="split-page__header">
          <button type="button" className="back-button" onClick={goBack}>
            <span className="back-button__icon" aria-hidden="true">&#8249;</span>
            <span>Warenkorb</span>
          </button>
          <h1 className="split-page__title">{tableName ?? `Tisch ${tableId}`}</h1>
        </div>
        <p className="empty-state">Keine Artikel im Warenkorb.</p>
      </div>
    )
  }

  const allAssigned = partyItems.unassigned.length === 0

  return (
    <div className="page split-page">
      {/* Header */}
      <div className="split-page__header">
        <button type="button" className="back-button" onClick={goBack} aria-label="Zurueck zum Warenkorb">
          <span className="back-button__icon" aria-hidden="true">&#8249;</span>
          <span>Warenkorb</span>
        </button>
        <h1 className="split-page__title">{tableName ?? `Tisch ${tableId}`}</h1>
      </div>

      {/* Party count controls */}
      <div className="split-controls" role="group" aria-label="Anzahl Personen">
        <span className="split-controls__label">Personen</span>
        <div className="split-controls__btns">
          <button
            type="button"
            className="split-controls__adj"
            onClick={() => setSplitCount(splitCount - 1)}
            disabled={splitCount <= 2}
            aria-label="Person entfernen"
          >
            &#8722;
          </button>
          <span className="split-controls__count" aria-live="polite">
            {splitCount}
          </span>
          <button
            type="button"
            className="split-controls__adj"
            onClick={() => setSplitCount(splitCount + 1)}
            disabled={splitCount >= 6}
            aria-label="Person hinzufuegen"
          >
            +
          </button>
        </div>
        {Object.keys(splitAssignments).length > 0 && (
          <button
            type="button"
            className="split-controls__reset"
            onClick={clearSplitAssignments}
          >
            Zuordnung aufheben
          </button>
        )}
      </div>

      {/* Item list — assign each line to a party */}
      <ul className="split-item-list" aria-label="Artikel zuordnen">
        {lineList.map((line) => {
          const currentParty = splitAssignments[line.item.id] ?? 0
          const lineTotal = line.qty * line.item.price
          return (
            <li key={line.item.id} className={`split-item${line.isExtra ? ' split-item--extra' : ''}`}>
              <div className="split-item__meta">
                <span className="split-item__name">
                  {line.item.name}
                  {line.isExtra && (
                    <span className="split-item__extra-badge">Extra</span>
                  )}
                </span>
                <span className="split-item__detail">
                  {line.qty} &times; {formatPrice(line.item.price)}
                  {' = '}
                  <strong>{formatPrice(lineTotal)}</strong>
                </span>
              </div>

              <div className="split-item__parties" role="group" aria-label={`Person fuer ${line.item.name}`}>
                {Array.from({ length: splitCount }, (_, i) => i + 1).map((p) => {
                  const active = currentParty === p
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`party-btn${active ? ' party-btn--active' : ''}`}
                      style={active ? { background: PARTY_COLORS[p - 1], borderColor: PARTY_COLORS[p - 1] } : { '--party-color': PARTY_COLORS[p - 1] } as React.CSSProperties}
                      onClick={() => handleAssign(line.item.id, p, currentParty)}
                      aria-pressed={active}
                      aria-label={`Person ${p}${active ? ' (aktiv, zum Aufheben tippen)' : ''}`}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Summary panel */}
      <div className="split-summary" aria-label="Aufteillungszusammenfassung">
        <h2 className="split-summary__title">Zusammenfassung</h2>

        {Array.from({ length: splitCount }, (_, i) => i + 1).map((p) => {
          const items = partyItems.groups[p] ?? []
          const subtotal = partyTotals.totals[p] ?? 0
          if (items.length === 0) return null
          return (
            <div
              key={p}
              className="split-summary__party"
              style={{ '--party-color': PARTY_COLORS[p - 1] } as React.CSSProperties}
            >
              <div className="split-summary__party-header">
                <span
                  className="split-summary__party-dot"
                  style={{ background: PARTY_COLORS[p - 1] }}
                />
                <span className="split-summary__party-name">Person {p}</span>
                <span className="split-summary__party-total">{formatPrice(subtotal)}</span>
              </div>
              <ul className="split-summary__items">
                {items.map((line) => (
                  <li key={line.item.id} className="split-summary__item">
                    <span>{line.qty}&thinsp;&times;&thinsp;{line.item.name}</span>
                    <span>{formatPrice(line.qty * line.item.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {partyItems.unassigned.length > 0 && (
          <div className="split-summary__party split-summary__party--unassigned">
            <div className="split-summary__party-header">
              <span className="split-summary__party-dot split-summary__party-dot--unassigned" />
              <span className="split-summary__party-name">Nicht zugeordnet</span>
              <span className="split-summary__party-total">{formatPrice(partyTotals.unassigned)}</span>
            </div>
            <ul className="split-summary__items">
              {partyItems.unassigned.map((line) => (
                <li key={line.item.id} className="split-summary__item">
                  <span>{line.qty}&thinsp;&times;&thinsp;{line.item.name}</span>
                  <span>{formatPrice(line.qty * line.item.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {allAssigned && (
          <p className="split-summary__all-assigned">
            &#10003; Alle Artikel zugeordnet
          </p>
        )}
      </div>

      {/* Back to cart CTA */}
      <button
        type="button"
        className="btn-primary split-done-btn"
        onClick={goBack}
      >
        Zurueck zum Warenkorb
      </button>
    </div>
  )
}
