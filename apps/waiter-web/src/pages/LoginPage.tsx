import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, ApiError } from '@bstoema/auth-context'

function mapLoginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Benutzername oder Passcode ist ungültig.'
    if (err.status === 401) return 'Benutzername oder Passcode ist falsch.'
    if (err.status === 409) return 'Kein aktives Event. Bitte den Operator kontaktieren.'
    if (err.status === 423) return 'Dein Konto ist gesperrt. Bitte den Operator kontaktieren.'
  }
  // fetch() throws TypeError when the network is unreachable
  if (err instanceof TypeError) {
    return 'Keine Verbindung zum Server. Bitte erneut versuchen.'
  }
  return 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.'
}

export function LoginPage() {
  const { loginWaiter, isLoggingIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [eventPasscode, setEventPasscode] = useState('')
  const [error, setError] = useState('')

  // After login, return to wherever the user was trying to reach (default: /tables)
  const from =
    (location.state as { from?: { pathname: string } } | null)?.from
      ?.pathname ?? '/tables'

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    try {
      await loginWaiter({ username, eventPasscode })
      navigate(from, { replace: true })
    } catch (err) {
      setError(mapLoginError(err))
    }
  }

  return (
    <div className="login-page">
      <h1 className="login-logo">BstöMa</h1>

      <form className="login-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Benutzername</span>
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Event-Passcode</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={eventPasscode}
            onChange={(e) => setEventPasscode(e.target.value)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={isLoggingIn}>
          {isLoggingIn ? 'Anmelden…' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
