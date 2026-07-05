import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useApiClient } from "../contexts/ApiClientContext";
import { ApiNoActiveEventError } from "@bstoema/api-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

/**
 * Builds the waiter-web URL phones should open. The API serves the waiter
 * PWA at `/waiter/`, so the URL is just the API origin (with its hostname
 * swapped for the server's LAN IP) plus `/waiter`.
 *
 * Prefers HTTPS when the API reports an `httpsPort` (camera access on phones
 * requires a secure context). Falls back to HTTP otherwise.
 *
 * `VITE_WAITER_WEB_URL` overrides everything (useful in dev when you run the
 * waiter Vite server on its own port and bind it to 0.0.0.0).
 */
async function resolveWaiterBaseUrl(): Promise<string> {
  const configured = import.meta.env.VITE_WAITER_WEB_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");

  let httpPort = 8787;
  try {
    const apiPort = new URL(API_BASE_URL).port;
    if (apiPort) httpPort = Number(apiPort);
  } catch {
    // ignore — keep default port
  }

  try {
    const res = await fetch(`${API_BASE_URL}/host-info`);
    if (res.ok) {
      const info = (await res.json()) as {
        localIp: string;
        httpPort?: number;
        httpsPort?: number;
      };
      if (info.httpsPort) {
        return `https://${info.localIp}:${info.httpsPort}/waiter`;
      }
      return `http://${info.localIp}:${info.httpPort ?? httpPort}/waiter`;
    }
  } catch {
    // Network error — fall through to hostname fallback
  }

  try {
    const url = new URL(API_BASE_URL);
    return `http://${url.hostname}:${httpPort}/waiter`;
  } catch {
    return `http://localhost:${httpPort}/waiter`;
  }
}

// ---------------------------------------------------------------------------
// OverviewPage
// ---------------------------------------------------------------------------

export function OverviewPage() {
  const api = useApiClient();

  const [passcode, setPasscode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noActiveEvent, setNoActiveEvent] = useState(false);

  // QR code
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [waiterUrl, setWaiterUrl] = useState<string | null>(null);

  // Rotate modal
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateSuccess, setRotateSuccess] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Resolve waiter URL once on mount (independent of passcode)
  // -------------------------------------------------------------------------
  useEffect(() => {
    resolveWaiterBaseUrl().then(setWaiterUrl);
  }, []);

  // -------------------------------------------------------------------------
  // Load passcode
  // -------------------------------------------------------------------------
  const loadPasscode = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNoActiveEvent(false);
    try {
      const { passcode: code } = await api.adminEvents.getPasscode();
      setPasscode(code);
    } catch (err) {
      if (err instanceof ApiNoActiveEventError) {
        setNoActiveEvent(true);
        setPasscode(null);
      } else {
        // PASSCODE_NOT_SET or other — stay visible so admin can rotate to initialise
        setPasscode(null);
        const code = (err as { code?: string }).code;
        if (err instanceof Error && code !== "PASSCODE_NOT_SET") {
          setLoadError(err.message);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadPasscode();
  }, [loadPasscode]);

  // -------------------------------------------------------------------------
  // QR code — regenerate whenever passcode or resolved waiter URL changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!passcode || !waiterUrl) {
      setQrDataUrl(null);
      return;
    }
    const url = `${waiterUrl}?passcode=${encodeURIComponent(passcode)}`;
    QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: "#111827", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [passcode, waiterUrl]);

  // -------------------------------------------------------------------------
  // Rotate
  // -------------------------------------------------------------------------
  async function handleRotate(e: React.FormEvent) {
    e.preventDefault();
    if (!newValue.trim()) return;
    setRotateError(null);
    setRotating(true);
    setRotateSuccess(false);
    try {
      const { passcode: updated } = await api.adminEvents.rotatePasscode(newValue.trim());
      setPasscode(updated);
      setRotateSuccess(true);
      setShowRotateModal(false);
      setNewValue("");
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRotating(false);
    }
  }

  function openRotateModal() {
    setNewValue("");
    setRotateError(null);
    setRotateSuccess(false);
    setShowRotateModal(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Übersicht</h1>
      </div>

      {/* No active event */}
      {noActiveEvent && (
        <div className="overview-notice">
          Kein aktives Event. Aktiviere zuerst ein Event auf der Master-Oberfläche.
        </div>
      )}

      {/* Loading */}
      {loading && !noActiveEvent && (
        <div className="overview-loading">Wird geladen…</div>
      )}

      {/* Passcode + QR cards */}
      {!loading && !noActiveEvent && (
        <div className="overview-grid">

          {/* Left: passcode display */}
          <div className="overview-card">
            <div className="overview-card__header">
              <span className="section-title">Event-Passcode</span>
              <button className="btn-secondary overview-rotate-btn" onClick={openRotateModal}>
                Rotieren
              </button>
            </div>

            {loadError && <p className="form-error">{loadError}</p>}

            {rotateSuccess && (
              <p className="overview-success">Passcode erfolgreich aktualisiert.</p>
            )}

            {passcode ? (
              <>
                <div className="overview-passcode">{passcode}</div>
                <p className="overview-passcode-hint">
                  Kellner geben diesen Code beim Login ein oder scannen den QR-Code.
                </p>
              </>
            ) : (
              <div className="overview-passcode-unset">
                Noch nicht gesetzt — bitte rotieren, um einen Passcode festzulegen.
              </div>
            )}
          </div>

          {/* Right: QR code */}
          {passcode && (
            <div className="overview-card overview-card--qr">
              <span className="section-title">QR-Code für Waiter-Login</span>
              {qrDataUrl ? (
                <>
                  <img
                    className="overview-qr-img"
                    src={qrDataUrl}
                    alt={`QR-Code für Passcode ${passcode}`}
                  />
                  {waiterUrl && (
                    <p className="overview-qr-hint">
                      {waiterUrl}
                    </p>
                  )}
                </>
              ) : (
                <div className="overview-loading">QR wird generiert…</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rotate modal */}
      {showRotateModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Passcode rotieren"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowRotateModal(false);
          }}
        >
          <div className="modal-card">
            <h3 className="modal-title">Passcode rotieren</h3>
            <p className="modal-subtitle">
              Bestehende Waiter-Sitzungen bleiben bis zum Ablauf gültig.
              Neue Logins erfordern den neuen Passcode.
            </p>

            <form onSubmit={handleRotate}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-passcode">
                  Neuer Passcode
                </label>
                <input
                  id="new-passcode"
                  ref={inputRef}
                  className="form-input passcode-input"
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="z. B. sommer24"
                />
              </div>

              {rotateError && <p className="form-error">{rotateError}</p>}

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowRotateModal(false)}
                  disabled={rotating}
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="btn-primary modal-submit"
                  disabled={rotating || !newValue.trim()}
                >
                  {rotating ? "Wird gespeichert…" : "Speichern"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
