import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@bstoema/auth-context";
import { useApiClient } from "../contexts/ApiClientContext";
import type { EventDto, AdminEventCreateRequest } from "@bstoema/shared-types";
import { WindowControls } from "../components/WindowControls";

type EventStatus = "active" | "inactive" | "closed";

function getStatus(ev: EventDto): EventStatus {
  if (ev.closedAt) return "closed";
  if (ev.isActive) return "active";
  return "inactive";
}

const EMPTY_FORM: AdminEventCreateRequest = {
  eventName: "",
  eventPasscode: "",
  adminUsername: "",
  adminPassword: "",
};

export function EventsPage() {
  const { logout } = useAuth();
  const api = useApiClient();
  const navigate = useNavigate();

  const [events, setEvents] = useState<EventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState<AdminEventCreateRequest>(EMPTY_FORM);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  function setBusyFor(id: number, val: boolean) {
    setBusy((prev) => ({ ...prev, [id]: val }));
  }

  async function reload() {
    setLoading(true);
    try {
      const list = await api.adminEvents.list();
      setEvents(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.adminEvents.create(form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      reload();
    } catch {
      setCreateError("Veranstaltung konnte nicht erstellt werden.");
    } finally {
      setCreating(false);
    }
  }

  async function handleActivate(id: number) {
    setBusyFor(id, true);
    try { await api.adminEvents.activate(id); await reload(); } finally { setBusyFor(id, false); }
  }

  async function handleDeactivate(id: number) {
    setBusyFor(id, true);
    try { await api.adminEvents.deactivate(id); await reload(); } finally { setBusyFor(id, false); }
  }

  async function handleClose(id: number) {
    if (!confirm("Veranstaltung wirklich schliessen? Das kann nicht rueckgaengig gemacht werden.")) return;
    setBusyFor(id, true);
    try { await api.adminEvents.close(id); await reload(); } finally { setBusyFor(id, false); }
  }

  const active   = events.filter((e) => getStatus(e) === "active");
  const inactive = events.filter((e) => getStatus(e) === "inactive");
  const closed   = events.filter((e) => getStatus(e) === "closed");

  return (
    <div className="standalone-page">
      {/* Title bar */}
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">BstöMa</span>
        <WindowControls />
      </div>

      {/* Scrollable content */}
      <div className="standalone-content">
        <div className="standalone-inner">

          {/* Page header */}
          <div className="page-header">
            <h1 className="page-title">Veranstaltungen</h1>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? "Abbrechen" : "+ Neue Veranstaltung"}
              </button>
              <button className="btn-ghost" onClick={logout}>Abmelden</button>
            </div>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="event-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 16, fontWeight: 600 }}>Neue Veranstaltung erstellen</h3>
              <form onSubmit={handleCreate}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" value={form.eventName}
                      onChange={(e) => setForm({ ...form, eventName: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Kellner-Passcode</label>
                    <input className="form-input" value={form.eventPasscode}
                      onChange={(e) => setForm({ ...form, eventPasscode: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Admin-Benutzername</label>
                    <input className="form-input" value={form.adminUsername}
                      onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Admin-Passwort</label>
                    <input className="form-input" type="password" value={form.adminPassword}
                      onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required />
                  </div>
                </div>
                {createError && <p className="form-error">{createError}</p>}
                <button className="btn-primary" type="submit" disabled={creating}
                  style={{ width: "auto", padding: "9px 20px" }}>
                  {creating ? "Erstellen..." : "Erstellen"}
                </button>
              </form>
            </div>
          )}

          {loading ? (
            <p className="muted">Laden...</p>
          ) : (
            <>
              <p className="section-title">Aktiv</p>
              {active.length === 0 ? (
                <div className="event-card event-card--empty" style={{ marginBottom: 20 }}>
                  <p className="muted">Keine aktive Veranstaltung.</p>
                </div>
              ) : active.map((ev) => (
                <EventRow key={ev.id} ev={ev} busy={!!busy[ev.id]}
                  onAdminLogin={() => navigate(`/events/${ev.id}/admin-login`)}
                  onDeactivate={() => handleDeactivate(ev.id)}
                  onClose={() => handleClose(ev.id)} />
              ))}

              {inactive.length > 0 && (
                <>
                  <p className="section-title" style={{ marginTop: 24 }}>Inaktiv</p>
                  {inactive.map((ev) => (
                    <EventRow key={ev.id} ev={ev} busy={!!busy[ev.id]}
                      onActivate={() => handleActivate(ev.id)}
                      onClose={() => handleClose(ev.id)} />
                  ))}
                </>
              )}

              {closed.length > 0 && (
                <>
                  <p className="section-title" style={{ marginTop: 24 }}>Geschlossen</p>
                  {closed.map((ev) => (
                    <EventRow key={ev.id} ev={ev} busy={!!busy[ev.id]} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  ev: EventDto;
  busy: boolean;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onClose?: () => void;
  onAdminLogin?: () => void;
}

function EventRow({ ev, busy, onActivate, onDeactivate, onClose, onAdminLogin }: RowProps) {
  const status = getStatus(ev);
  const cardClass = [
    "event-card",
    status === "inactive" ? "event-card--inactive" : "",
    status === "closed"   ? "event-card--closed"   : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cardClass}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        {status === "active"   && <span className="badge-active">Aktiv</span>}
        {status === "inactive" && <span className="badge-inactive">Inaktiv</span>}
        {status === "closed"   && <span className="badge-closed">Geschlossen</span>}
        <span style={{ fontWeight: 600 }}>{ev.eventName}</span>
        <span className="muted" style={{ fontSize: 12 }}>#{ev.id}</span>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: onActivate || onDeactivate || onAdminLogin ? 12 : 0 }}>
        Admin: {ev.adminUsername}
        {ev.closedAt && (
          <span style={{ marginLeft: 10 }}>
            Geschlossen: {new Date(ev.closedAt).toLocaleDateString("de-DE")}
          </span>
        )}
      </p>
      {(onActivate || onDeactivate || onAdminLogin) && (
        <div style={{ display: "flex", gap: 8 }}>
          {onAdminLogin && (
            <button className="btn-primary" disabled={busy}
              style={{ width: "auto", padding: "7px 16px" }} onClick={onAdminLogin}>
              Als Admin anmelden
            </button>
          )}
          {onActivate && (
            <button className="btn-secondary" disabled={busy} onClick={onActivate}>
              {busy ? "..." : "Aktivieren"}
            </button>
          )}
          {onDeactivate && (
            <button className="btn-ghost" disabled={busy} onClick={onDeactivate}>
              {busy ? "..." : "Deaktivieren"}
            </button>
          )}
          {onClose && (
            <button className="btn-ghost" disabled={busy}
              style={{ color: "#ef4444" }} onClick={onClose}>
              {busy ? "..." : "Schliessen"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
