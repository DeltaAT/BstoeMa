import { useEffect } from 'react'
import type { PrintResultModalState } from '../lib/order-submit'

// ---------------------------------------------------------------------------
// Print result modal
// ---------------------------------------------------------------------------
//
// Shown after an order is submitted and its bons printed. Auto-dismisses on
// full success so the waiter can move straight on to payment; stays open on
// errors until acknowledged.

interface PrintResultModalProps {
  state: PrintResultModalState
  onClose: () => void
}

export function PrintResultModal({ state, onClose }: PrintResultModalProps) {
  useEffect(() => {
    if (!state.allOk) return
    const timer = setTimeout(onClose, 2200)
    return () => clearTimeout(timer)
  }, [state.allOk, onClose])

  const headerLabel = !state.printingEnabled
    ? 'Bondrucke deaktiviert'
    : state.allOk
    ? 'Bons gedruckt'
    : 'Druck mit Fehlern'

  return (
    <div
      className="print-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`print-modal print-modal--${state.allOk ? 'ok' : 'err'}`}>
        <div className="print-modal__header">
          <h3>{state.title}</h3>
          <button
            type="button"
            className="print-modal__close"
            onClick={onClose}
            aria-label="Schliessen"
          >
            &times;
          </button>
        </div>

        <div className="print-modal__body">
          <p className="print-modal__status">
            {state.allOk ? '✓ ' : '⚠ '}
            {headerLabel}
          </p>

          {state.runs.map((run, runIdx) => (
            <div key={runIdx} className="print-modal__run">
              <div className="print-modal__run-label">{run.label}</div>
              {run.error ? (
                <p className="print-modal__error">
                  Druckauftrag fehlgeschlagen: {run.error}
                </p>
              ) : !run.printingEnabled ? (
                <p className="print-modal__hint">
                  Bondrucke sind deaktiviert. Bestellung wurde gespeichert.
                </p>
              ) : run.results.length === 0 ? (
                <p className="print-modal__hint">Keine Bons fuer diesen Auftrag.</p>
              ) : (
                <ul className="print-modal__results">
                  {run.results.map((result, idx) => (
                    <li
                      key={idx}
                      className={`print-modal__result print-modal__result--${result.status}`}
                    >
                      <div className="print-modal__result-line">
                        <span className="print-modal__result-icon" aria-hidden="true">
                          {result.status === 'ok'
                            ? '✓'
                            : result.status === 'skipped'
                            ? '–'
                            : result.status === 'queued'
                            ? '⧗'
                            : '✗'}
                        </span>
                        <span className="print-modal__result-name">
                          {result.printerName}
                        </span>
                        <span className="print-modal__result-count">
                          {result.itemCount}&nbsp;Pos.
                        </span>
                      </div>
                      {result.status !== 'ok' && (
                        <div className="print-modal__result-msg">
                          {result.message}
                          {result.hint ? ` — ${result.hint}` : ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="print-modal__footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            {state.allOk ? 'Weiter zur Zahlung' : 'Verstanden'}
          </button>
        </div>
      </div>
    </div>
  )
}
