import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@serva/auth-context";
import { WindowControls } from "../components/WindowControls";

export function LoginPage() {
  const { role, eventId, isLoading, isLoggingIn, loginMaster } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <div className="loading-screen">Laden...</div>;
  if (role === "master") return <Navigate to="/events" replace />;
  if (role === "admin" && eventId != null) {
    return <Navigate to={`/events/${eventId}/menu`} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await loginMaster({ username, password });
    } catch {
      setError("Anmeldung fehlgeschlagen. Benutzername oder Passwort ist falsch.");
    }
  }

  return (
    <div className="standalone-page">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">Serva</span>
        <WindowControls />
      </div>
      <div className="login-page">
        <div className="login-card">
          <h1>Serva</h1>
          <p className="login-subtitle">Master-Anmeldung</p>
          <form onSubmit={handleSubmit}>
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
        </div>
      </div>
    </div>
  );
}
