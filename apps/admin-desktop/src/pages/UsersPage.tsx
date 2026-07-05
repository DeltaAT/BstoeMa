import { useCallback, useEffect, useRef, useState } from "react";
import type { UserDto } from "@bstoema/shared-types";
import { ApiConflictError } from "@bstoema/api-client";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

type LockedFilter = "all" | "locked" | "unlocked";

interface UserFormState {
  username: string;
  isLocked: boolean;
}

function defaultForm(): UserFormState {
  return { username: "", isLocked: false };
}

// ---------------------------------------------------------------------------
// CreateUserModal
// ---------------------------------------------------------------------------

interface CreateUserModalProps {
  onClose: () => void;
  onSave: (form: UserFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function CreateUserModal({ onClose, onSave, saving, saveError }: CreateUserModalProps) {
  const [form, setForm] = useState<UserFormState>(defaultForm());
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => usernameRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const canSubmit = form.username.trim() !== "";

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" style={{ width: 420 }}>
        <h3 className="modal-title">Neuer Kellner</h3>
        <p className="modal-subtitle">
          Wird angelegt — der Kellner kann sich anschließend mit Benutzername und Event-Passcode anmelden.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="user-username">
              Benutzername <span className="required-star">*</span>
            </label>
            <input
              id="user-username"
              ref={usernameRef}
              className="form-input"
              type="text"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              required
              maxLength={100}
              placeholder="z. B. anna"
              autoComplete="off"
            />
          </div>

          <div className="form-group cat-checkbox-group">
            <label className="form-label" htmlFor="user-locked">
              Status
            </label>
            <label className="cat-checkbox-label" htmlFor="user-locked">
              <input
                id="user-locked"
                type="checkbox"
                checked={form.isLocked}
                onChange={(e) => set("isLocked", e.target.checked)}
              />
              Gesperrt anlegen
            </label>
            <span className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Gesperrte Kellner können sich nicht anmelden.
            </span>
          </div>

          {saveError && <p className="form-error">{saveError}</p>}

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="btn-primary modal-submit"
              disabled={saving || !canSubmit}
            >
              {saving ? "Wird gespeichert…" : "Anlegen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmModal
// ---------------------------------------------------------------------------

interface DeleteConfirmModalProps {
  user: UserDto;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}

function DeleteConfirmModal({ user, onClose, onConfirm, deleting, error }: DeleteConfirmModalProps) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" style={{ width: 420 }}>
        <h3 className="modal-title">Kellner löschen</h3>
        <p className="modal-subtitle">
          „{user.username}" wird unwiderruflich entfernt. Wenn der Kellner sich später erneut
          anmeldet, wird der Account neu angelegt — ggf. lieber sperren statt löschen.
        </p>
        {error && <div className="cat-delete-error" style={{ marginTop: 12 }}>{error}</div>}
        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? "Wird gelöscht…" : "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UsersPage
// ---------------------------------------------------------------------------

export function UsersPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [users, setUsers] = useState<UserDto[]>([]);

  const [search, setSearch] = useState("");
  const [lockedFilter, setLockedFilter] = useState<LockedFilter>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<UserDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Load (server-side filter) ─────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const trimmed = search.trim();
      const { users: list } = await api.users.list({
        ...(lockedFilter !== "all" && { locked: lockedFilter === "locked" }),
        ...(trimmed !== "" && { search: trimmed }),
      });
      setUsers(list);
      setState({ status: "ok" });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Fehler beim Laden.",
      });
    }
  }, [api, lockedFilter, search]);

  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, [load]);

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate(form: UserFormState) {
    setSaving(true);
    setSaveError(null);
    try {
      await api.users.create({
        username: form.username.trim(),
        ...(form.isLocked && { isLocked: true }),
      });
      setCreateOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiConflictError && err.code === "USER_ALREADY_EXISTS") {
        setSaveError("Ein Kellner mit diesem Benutzernamen existiert bereits.");
      } else {
        setSaveError(err instanceof Error ? err.message : "Fehler beim Speichern.");
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Lock toggle (optimistic) ──────────────────────────────────────────────

  async function handleToggleLock(user: UserDto) {
    const previous = users;
    const optimistic = { ...user, isLocked: !user.isLocked };
    setUsers((prev) => prev.map((u) => (u.id === user.id ? optimistic : u)));
    try {
      const result = await api.users.update(user.id, { isLocked: !user.isLocked });
      setUsers((prev) => prev.map((u) => (u.id === result.id ? result : u)));
    } catch {
      setUsers(previous);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.users.delete(deleteTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Fehler beim Löschen.");
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const header = (
    <div className="page-header">
      <h1 className="page-title">Kellner</h1>
      <button
        className="btn-primary"
        style={{ width: "auto" }}
        onClick={() => {
          setSaveError(null);
          setCreateOpen(true);
        }}
      >
        + Neuer Kellner
      </button>
    </div>
  );

  const toolbar = (
    <div className="users-toolbar">
      <input
        className="form-input users-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Suchen…"
      />
      <div className="users-filter">
        {(
          [
            ["all", "Alle"],
            ["unlocked", "Aktiv"],
            ["locked", "Gesperrt"],
          ] as Array<[LockedFilter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`users-filter__btn${lockedFilter === key ? " users-filter__btn--active" : ""}`}
            onClick={() => setLockedFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (state.status === "loading") {
    return (
      <div>
        {header}
        {toolbar}
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        {header}
        {toolbar}
        <p className="form-error">{state.message}</p>
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div>
      {header}
      {toolbar}

      {users.length === 0 ? (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">
            {search.trim() !== "" || lockedFilter !== "all"
              ? "Keine Kellner entsprechen dem Filter."
              : "Noch keine Kellner. Sie werden auch automatisch beim ersten Login angelegt."}
          </p>
          {search.trim() === "" && lockedFilter === "all" && (
            <button
              className="btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => {
                setSaveError(null);
                setCreateOpen(true);
              }}
            >
              Kellner anlegen
            </button>
          )}
        </div>
      ) : (
        <div className="users-list">
          <div className="users-row users-row--header">
            <span className="users-col-name">Benutzername</span>
            <span className="users-col-status">Status</span>
            <span className="users-col-actions" />
          </div>

          {users.map((user) => (
            <div key={user.id} className="users-row">
              <span className="users-col-name">{user.username}</span>
              <span className="users-col-status">
                {user.isLocked ? (
                  <span className="badge-locked">Gesperrt</span>
                ) : (
                  <span className="badge-unlocked">Aktiv</span>
                )}
              </span>
              <span className="users-col-actions">
                <button
                  className={`btn-icon${user.isLocked ? " btn-icon--unlock" : ""}`}
                  title={user.isLocked ? "Entsperren" : "Sperren"}
                  onClick={() => handleToggleLock(user)}
                >
                  {user.isLocked ? "🔓" : "🔒"}
                </button>
                <button
                  className="btn-icon btn-icon--danger"
                  title="Löschen"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(user);
                  }}
                >
                  🗑
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onSave={handleCreate}
          saving={saving}
          saveError={saveError}
        />
      )}

      {deleteTarget != null && (
        <DeleteConfirmModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
}
