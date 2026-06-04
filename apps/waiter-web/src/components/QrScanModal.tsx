import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import QrScanner from 'qr-scanner'

type Props = {
  onScan: (qrValue: string) => void
  onClose: () => void
  onPermissionDenied: () => void
}

// Live camera access (getUserMedia) is gated by browsers behind a secure
// context — HTTPS or localhost. On a plain-HTTP LAN/Meshnet address that gate
// can't be lifted from JS, so we fall back to a native photo capture, which is
// NOT subject to the secure-context restriction.
function liveCameraAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
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

  // Decide the capture mode once on mount: live scanner where the browser
  // allows it, photo capture otherwise (e.g. served over HTTP via Meshnet).
  const [mode] = useState<'live' | 'photo'>(() =>
    liveCameraAvailable() ? 'live' : 'photo',
  )
  const [error, setError] = useState<string | null>(null)
  const [decoding, setDecoding] = useState(false)

  useEffect(() => {
    if (mode !== 'live') return
    const video = videoRef.current
    if (!video) return

    let cancelled = false

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
  }, [mode])

  // Photo-capture fallback: decode the QR from a still image taken with the
  // device's native camera. Works over plain HTTP since it doesn't touch
  // getUserMedia.
  const handlePhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so picking the same photo again still fires onChange.
    e.target.value = ''
    if (!file) return

    setError(null)
    setDecoding(true)
    try {
      const result = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
      })
      onScanRef.current(result.data)
    } catch {
      setError(
        'Im Foto wurde kein QR-Code erkannt. Bitte näher herangehen, auf gute Beleuchtung achten und erneut aufnehmen.',
      )
    } finally {
      setDecoding(false)
    }
  }

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

        {mode === 'live' ? (
          error ? (
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
          )
        ) : (
          <div className="qr-modal__photo">
            <p className="qr-modal__hint">
              Live-Kamera ist nur über HTTPS verfügbar. Nimm stattdessen ein
              Foto des Tisch-QR-Codes auf.
            </p>
            <label className="btn-primary qr-modal__capture">
              {decoding ? 'QR-Code wird gelesen…' : 'Foto aufnehmen'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={decoding}
                onChange={handlePhoto}
              />
            </label>
            {error && <p className="error-message">{error}</p>}
            <button
              type="button"
              className="qr-modal__secondary"
              onClick={onClose}
            >
              Zurück zur Liste
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
