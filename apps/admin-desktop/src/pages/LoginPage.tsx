import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@bstoema/auth-context";
import { useApiClient } from "../contexts/ApiClientContext";
import { WindowControls } from "../components/WindowControls";

export function LoginPage() {
  const { role, eventId, isLoading, isLoggingIn, loginMaster } = useAuth();
  const client = useApiClient();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // null = still checking whether master credentials exist.
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.auth
      .masterStatus()
      .then((res) => {
        if (!cancelled) setConfigured(res.configured);
      })
      .catch(() => {
        // API unreachable — assume configured and let the login attempt surface
        // the real connection error.
        if (!cancelled) setConfigured(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (isLoading || configured === null) {
    return <div className="loading-screen">Laden...</div>;
  }
  if (role === "master") return <Navigate to="/events" replace />;
  if (role === "admin" && eventId != null) {
    return <Navigate to={`/events/${eventId}/menu`} replace />;
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await loginMaster({ username, password });
    } catch {
      setError("Anmeldung fehlgeschlagen. Benutzername oder Passwort ist falsch.");
    }
  }

  async function handleSetup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    setSubmitting(true);
    try {
      await client.auth.masterSetup({ username, password });
      // Immediately sign in with the freshly created credentials.
      await loginMaster({ username, password });
    } catch {
      setError("Einrichtung fehlgeschlagen. Bitte erneut versuchen.");
      setSubmitting(false);
    }
  }

  return (
    <div className="standalone-page">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">BstöMa</span>
        <WindowControls />
      </div>
      <div className="login-page">
        <div className="login-card">
          <h1>BstöMa</h1>
          {configured ? (
            <>
              <p className="login-subtitle">Master-Anmeldung</p>
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label className="form-label" htmlFor="username">Benutzername</label>
                  <input id="username" className="form-input" type="text" autoComplete="username"
                    value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="password">Passwort</label>
                  <input id="password" className="form-input" type="password" autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error && <p className="form-error">{error}</p>}
                <button className="btn-primary" type="submit" disabled={isLoggingIn}>
                  {isLoggingIn ? "Anmelden..." : "Anmelden"}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="login-subtitle">Ersteinrichtung — Master-Konto anlegen</p>
              <form onSubmit={handleSetup}>
                <div className="form-group">
                  <label className="form-label" htmlFor="username">Benutzername</label>
                  <input id="username" className="form-input" type="text" autoComplete="username"
                    value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="password">Passwort (mind. 8 Zeichen)</label>
                  <input id="password" className="form-input" type="password" autoComplete="new-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="confirmPassword">Passwort bestätigen</label>
                  <input id="confirmPassword" className="form-input" type="password" autoComplete="new-password"
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                </div>
                {error && <p className="form-error">{error}</p>}
                <button className="btn-primary" type="submit" disabled={submitting || isLoggingIn}>
                  {submitting ? "Konto wird angelegt..." : "Master-Konto anlegen"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
