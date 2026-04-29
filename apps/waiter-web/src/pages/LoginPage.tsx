import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@serva/auth-context'

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
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen')
    }
  }

  return (
    <div className="login-page">
      <h1 className="login-logo">Serva</h1>

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
