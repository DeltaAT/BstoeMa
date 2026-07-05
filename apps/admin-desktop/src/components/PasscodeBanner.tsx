import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useApiClient } from "../contexts/ApiClientContext";
import { ApiNoActiveEventError } from "@bstoema/api-client";

// ---------------------------------------------------------------------------
// Env config — optional explicit waiter-web URL (e.g. dev Vite server on :5174).
// When unset (the shipped build), we derive the URL at runtime from the API's
// /host-info: the real LAN IP plus the HTTPS port, so the QR is an https:// link
// phones can open in a secure context (required for the live camera scanner).
// ---------------------------------------------------------------------------
const WAITER_WEB_URL_OVERRIDE: string | null =
  (import.meta.env.VITE_WAITER_WEB_URL as string | undefined)?.replace(
    /\/+$/,
    "",
  ) || null;

// ---------------------------------------------------------------------------
// PasscodeBanner
// ---------------------------------------------------------------------------

export function PasscodeBanner() {
  const api = useApiClient();

  const [passcode, setPasscode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false); // no active event

  // QR code data-URL
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Waiter-web base URL (without passcode). Derived from /host-info unless an
  // explicit override is configured.
  const [waiterBase, setWaiterBase] = useState<string | null>(
    WAITER_WEB_URL_OVERRIDE,
  );

  // Rotate modal state
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Load passcode
  // -------------------------------------------------------------------------
  const loadPasscode = useCallback(async () => {
    setLoading(true);
    try {
      const { passcode: code } = await api.adminEvents.getPasscode();
      setPasscode(code);
      setHidden(false);
    } catch (err) {
      if (err instanceof ApiNoActiveEventError) {
        // No event active — hide the banner entirely
        setHidden(true);
        setPasscode(null);
      } else {
        // PASSCODE_NOT_SET (or any other error): stay visible, show "Nicht gesetzt"
        // so the admin knows to rotate and initialise the value.
        setHidden(false);
        setPasscode(null);
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadPasscode();
  }, [loadPasscode]);

  // -------------------------------------------------------------------------
  // Resolve the waiter-web URL from the server's LAN IP + HTTPS port.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (WAITER_WEB_URL_OVERRIDE) return; // explicit override wins
    let cancelled = false;
    api.ops
      .hostInfo()
      .then((info) => {
        if (cancelled) return;
        // Prefer HTTPS so the waiter app loads in a secure context and the live
        // camera QR scanner works; fall back to HTTP only if no cert is active.
        const protocol = info.httpsPort ? "https" : "http";
        const port = info.httpsPort ?? info.httpPort;
        setWaiterBase(`${protocol}://${info.localIp}:${port}/waiter`);
      })
      .catch(() => {
        if (!cancelled) setWaiterBase(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // -------------------------------------------------------------------------
  // Generate QR code whenever the passcode or waiter URL changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!passcode || !waiterBase) {
      setQrDataUrl(null);
      return;
    }
    const url = `${waiterBase}?passcode=${encodeURIComponent(passcode)}`;
    QRCode.toDataURL(url, { width: 200, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [passcode, waiterBase]);

  // -------------------------------------------------------------------------
  // Rotate
  // -------------------------------------------------------------------------
  async function handleRotate(e: React.FormEvent) {
    e.preventDefault();
    if (!newValue.trim()) return;
    setRotateError(null);
    setRotating(true);
    try {
      const { passcode: updated } = await api.adminEvents.rotatePasscode(newValue.trim());
      setPasscode(updated);
      setShowRotateModal(false);
      setNewValue("");
      setShowQr(false);
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setRotating(false);
    }
  }

  function openRotateModal() {
    setNewValue("");
    setRotateError(null);
    setShowRotateModal(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // -------------------------------------------------------------------------
  // Render — hidden when no active event
  // -------------------------------------------------------------------------
  if (hidden || loading) return null;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Passcode card in the sidebar                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="passcode-banner">
        <span className="passcode-banner__label">Event-Passcode</span>

        {passcode ? (
          <span className="passcode-banner__code">{passcode}</span>
        ) : (
          <span className="passcode-banner__unset">Nicht gesetzt</span>
        )}

        <div className="passcode-banner__actions">
          <button
            className="passcode-banner__btn"
            onClick={openRotateModal}
            title="Passcode rotieren"
          >
            Rotieren
          </button>

          {passcode && (
            <button
              className={`passcode-banner__btn passcode-banner__btn--qr${showQr ? " passcode-banner__btn--active" : ""}`}
              onClick={() => setShowQr((v) => !v)}
              title="QR-Code anzeigen"
            >
              QR
            </button>
          )}
        </div>

        {showQr && qrDataUrl && (
          <div className="passcode-banner__qr">
            <img src={qrDataUrl} alt={`QR-Code für Passcode ${passcode}`} width={160} height={160} />
            <span className="passcode-banner__qr-hint">Waiter-Login scannen</span>
            {waiterBase && (
              <span className="passcode-banner__qr-url" title={waiterBase}>
                {waiterBase}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Rotate modal                                                        */}
      {/* ------------------------------------------------------------------ */}
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

              {rotateError && (
                <p className="form-error">{rotateError}</p>
              )}

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
    </>
  );
}
