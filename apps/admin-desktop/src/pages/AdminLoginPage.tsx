import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@serva/auth-context";
import { WindowControls } from "../components/WindowControls";

export function AdminLoginPage() {
  const { eventId: paramEventId } = useParams<{ eventId: string }>();
  const { role, eventId: authEventId, isLoading, isLoggingIn, loginAdmin } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <div className="loading-screen">Laden...</div>;

  if (role === "admin" && authEventId != null) {
    return <Navigate to={`/events/${authEventId}/menu`} replace />;
  }

  const numericEventId = Number(paramEventId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await loginAdmin({ eventId: numericEventId, username, password });
      navigate(`/events/${numericEventId}/menu`, { replace: true });
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
          <button
            type="button"
            className="back-button"
            onClick={() => navigate("/events")}
            disabled={isLoggingIn}
            aria-label="Zurueck zur Veranstaltungsliste"
          >
            <span className="back-button__icon" aria-hidden="true">&#8249;</span>
            <span>Veranstaltungen</span>
          </button>
          <h1>Serva</h1>
          <p className="login-subtitle">Admin-Anmeldung &middot; Veranstaltung #{paramEventId}</p>
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
              {isLoggingIn ? "Anmelden..." : "Als Admin anmelden"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
