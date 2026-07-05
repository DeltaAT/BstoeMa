import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderDisplayDto } from "@bstoema/shared-types";
import { ApiConflictError } from "@bstoema/api-client";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface OrderDisplayFormState {
  name: string;
  ipAddress: string;
  connectionDetails: string;
}

function defaultForm(display?: OrderDisplayDto): OrderDisplayFormState {
  return {
    name: display?.name ?? "",
    ipAddress: display?.ipAddress ?? "",
    connectionDetails: display?.connectionDetails ?? "",
  };
}

// ---------------------------------------------------------------------------
// OrderDisplayFormModal
// ---------------------------------------------------------------------------

interface OrderDisplayFormModalProps {
  editing: OrderDisplayDto | null;
  onClose: () => void;
  onSave: (form: OrderDisplayFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function OrderDisplayFormModal({
  editing,
  onClose,
  onSave,
  saving,
  saveError,
}: OrderDisplayFormModalProps) {
  const [form, setForm] = useState<OrderDisplayFormState>(defaultForm(editing ?? undefined));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof OrderDisplayFormState>(key: K, value: OrderDisplayFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const canSubmit = form.name.trim() !== "" && form.ipAddress.trim() !== "";

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" style={{ width: 460 }}>
        <h3 className="modal-title">
          {editing ? "Bestellanzeige bearbeiten" : "Neue Bestellanzeige"}
        </h3>
        <p className="modal-subtitle">
          {editing
            ? `ID ${editing.id} · Felder anpassen.`
            : "Routing-Ziel für eine Küchen- oder Bar-Anzeige hinzufügen."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="display-name">
              Name <span className="required-star">*</span>
            </label>
            <input
              id="display-name"
              ref={nameRef}
              className="form-input"
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={100}
              placeholder="z. B. Küchenanzeige"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="display-ip">
              IP-Adresse <span className="required-star">*</span>
            </label>
            <input
              id="display-ip"
              className="form-input"
              type="text"
              value={form.ipAddress}
              onChange={(e) => set("ipAddress", e.target.value)}
              required
              placeholder="z. B. 192.168.1.50"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="display-details">
              Verbindungsdetails
            </label>
            <input
              id="display-details"
              className="form-input"
              type="text"
              value={form.connectionDetails}
              onChange={(e) => set("connectionDetails", e.target.value)}
              maxLength={500}
              placeholder="Optional"
            />
            <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
              Port, Pfad o. Ä.
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
              {saving ? "Wird gespeichert…" : "Speichern"}
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
  display: OrderDisplayDto;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}

function DeleteConfirmModal({
  display,
  onClose,
  onConfirm,
  deleting,
  error,
}: DeleteConfirmModalProps) {
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
        <h3 className="modal-title">Bestellanzeige löschen</h3>
        <p className="modal-subtitle">„{display.name}" wird unwiderruflich entfernt.</p>
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
// OrderDisplaysPage
// ---------------------------------------------------------------------------

export function OrderDisplaysPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [displays, setDisplays] = useState<OrderDisplayDto[]>([]);

  const [editTarget, setEditTarget] = useState<OrderDisplayDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<OrderDisplayDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { orderDisplays } = await api.orderDisplays.list();
      setDisplays(orderDisplays);
      setState({ status: "ok" });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Fehler beim Laden.",
      });
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Create / Update ───────────────────────────────────────────────────────

  async function handleSave(form: OrderDisplayFormState) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editTarget === "new") {
        const created = await api.orderDisplays.create({
          name: form.name.trim(),
          ipAddress: form.ipAddress.trim(),
          ...(form.connectionDetails.trim() !== "" && {
            connectionDetails: form.connectionDetails.trim(),
          }),
        });
        setDisplays((prev) => [...prev, created]);
      } else if (editTarget) {
        const updated = await api.orderDisplays.update(editTarget.id, {
          name: form.name.trim(),
          ipAddress: form.ipAddress.trim(),
          connectionDetails: form.connectionDetails.trim(),
        });
        setDisplays((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      }
      setEditTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.orderDisplays.delete(deleteTarget.id);
      setDisplays((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof ApiConflictError) {
        setDeleteError(
          "Diese Bestellanzeige ist noch einer Menükategorie zugeordnet. " +
            "Entfernen Sie zuerst die Anzeige aus der Kategorie und versuchen Sie es erneut.",
        );
      } else {
        setDeleteError(err instanceof Error ? err.message : "Fehler beim Löschen.");
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Bestellanzeigen</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Bestellanzeigen</h1>
        </div>
        <p className="form-error">{state.message}</p>
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bestellanzeigen</h1>
        <button
          className="btn-primary"
          style={{ width: "auto" }}
          onClick={() => {
            setSaveError(null);
            setEditTarget("new");
          }}
        >
          + Neue Bestellanzeige
        </button>
      </div>

      {displays.length === 0 ? (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">Noch keine Bestellanzeigen konfiguriert.</p>
          <button
            className="btn-primary"
            style={{ marginTop: 14 }}
            onClick={() => {
              setSaveError(null);
              setEditTarget("new");
            }}
          >
            Bestellanzeige hinzufügen
          </button>
        </div>
      ) : (
        // Reuses the printer table layout — no test-print column for now, so
        // the status cell is omitted and actions sit right after details.
        <div className="printers-list">
          <div className="printers-row printers-row--header">
            <span className="printers-col-name">Name</span>
            <span className="printers-col-ip">IP-Adresse</span>
            <span className="printers-col-details">Verbindungsdetails</span>
            <span className="printers-col-status" />
            <span className="printers-col-actions" />
          </div>

          {displays.map((display) => (
            <div key={display.id} className="printers-item">
              <div className="printers-row">
                <span className="printers-col-name">{display.name}</span>
                <span className="printers-col-ip">{display.ipAddress}</span>
                <span className="printers-col-details">
                  {display.connectionDetails || <span className="muted">—</span>}
                </span>
                <span className="printers-col-status" />
                <span className="printers-col-actions">
                  <button
                    className="btn-icon"
                    title="Bearbeiten"
                    onClick={() => {
                      setSaveError(null);
                      setEditTarget(display);
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn-icon btn-icon--danger"
                    title="Löschen"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(display);
                    }}
                  >
                    🗑
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {editTarget != null && (
        <OrderDisplayFormModal
          editing={editTarget === "new" ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
          saving={saving}
          saveError={saveError}
        />
      )}

      {deleteTarget != null && (
        <DeleteConfirmModal
          display={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
}
