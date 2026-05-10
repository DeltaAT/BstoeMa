import { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'

type Props = {
  onScan: (qrValue: string) => void
  onClose: () => void
  onPermissionDenied: () => void
}

export function QrScanModal({ onScan, onClose, onPermissionDenied }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Latest-ref pattern: keep callbacks stable so the scanner effect runs once.
  const onScanRef = useRef(onScan)
  const onPermissionDeniedRef = useRef(onPermissionDenied)
  useEffect(() => {
    onScanRef.current = onScan
    onPermissionDeniedRef.current = onPermissionDenied
  })

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let cancelled = false

    // Browsers gate getUserMedia behind a secure context (HTTPS or localhost).
    // Detect this up front so the waiter sees a useful message instead of a
    // silent "no permission prompt".
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError(
        'Kamera-Zugriff ist nur über HTTPS (oder localhost) möglich. Aktuelle Seite läuft über HTTP – bitte den Operator bitten, die Verbindung auf HTTPS umzustellen.',
      )
      return
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setError('Dieses Gerät unterstützt keinen Kamera-Zugriff im Browser.')
      return
    }

    const scanner = new QrScanner(
      video,
      (result) => {
        if (cancelled) return
        cancelled = true
        scanner.stop()
        onScanRef.current(result.data)
      },
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
      },
    )

    scanner.start().catch((err: unknown) => {
      if (cancelled) return
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name: unknown }).name)
          : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        onPermissionDeniedRef.current()
        return
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Kamera konnte nicht gestartet werden.',
      )
    })

    return () => {
      cancelled = true
      scanner.stop()
      scanner.destroy()
    }
  }, [])

  return (
    <div
      className="qr-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="QR-Code scannen"
      onClick={onClose}
    >
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-modal__header">
          <h3>QR-Code scannen</h3>
          <button
            type="button"
            className="qr-modal__close"
            onClick={onClose}
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="qr-modal__error">
            <p className="error-message">{error}</p>
            <button type="button" className="btn-primary" onClick={onClose}>
              Zurück zur Liste
            </button>
          </div>
        ) : (
          <>
            <div className="qr-modal__video-wrap">
              <video ref={videoRef} className="qr-modal__video" muted playsInline />
            </div>
            <p className="qr-modal__hint">
              Tisch-QR ins Bild halten – das Menü öffnet sich automatisch.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
