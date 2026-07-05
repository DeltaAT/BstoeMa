import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnouncementDto } from '@bstoema/shared-types'
import { useApiClient } from '../hooks/useApiClient'

const POLL_INTERVAL_MS = 5000

export function AnnouncementOverlay() {
  const api = useApiClient()
  const [queue, setQueue] = useState<AnnouncementDto[]>([])
  const lastIdRef = useRef(0)
  const liveRef = useRef(true)

  const poll = useCallback(async () => {
    try {
      const { announcements } = await api.announcements.list({
        since: lastIdRef.current,
      })
      if (!liveRef.current) return
      if (announcements.length > 0) {
        const maxId = Math.max(...announcements.map((a) => a.id))
        lastIdRef.current = maxId
        setQueue((prev) => [...prev, ...announcements])
      }
    } catch {
      // silent — network hiccups shouldn't break the waiter flow
    }
  }, [api])

  useEffect(() => {
    liveRef.current = true
    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      liveRef.current = false
      clearInterval(timer)
    }
  }, [poll])

  function dismiss() {
    setQueue((prev) => prev.slice(1))
  }

  const current = queue[0]
  if (!current) return null

  const severityClass =
    current.severity === 'urgent'
      ? 'ann-modal--urgent'
      : current.severity === 'warning'
        ? 'ann-modal--warning'
        : 'ann-modal--info'

  const severityLabel =
    current.severity === 'urgent'
      ? 'Dringend'
      : current.severity === 'warning'
        ? 'Warnung'
        : 'Info'

  return (
    <div className="ann-backdrop">
      <div className={`ann-modal ${severityClass}`}>
        <div className="ann-modal__header">
          <span className="ann-modal__badge">{severityLabel}</span>
          {queue.length > 1 && (
            <span className="ann-modal__count">
              +{queue.length - 1} weitere
            </span>
          )}
        </div>
        <div className="ann-modal__body">
          <p className="ann-modal__message">{current.message}</p>
          <p className="ann-modal__meta">
            {current.createdBy} &middot;{' '}
            {new Date(current.createdAt).toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <div className="ann-modal__footer">
          <button
            type="button"
            className="btn-primary ann-modal__ok"
            onClick={dismiss}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
