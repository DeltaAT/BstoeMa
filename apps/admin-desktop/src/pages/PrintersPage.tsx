import { useCallback, useEffect, useRef, useState } from "react";
import type { PrinterDto } from "@bstoema/shared-types";
import { ApiConflictError, ApiPrinterError } from "@bstoema/api-client";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface PrinterFormState {
  name: string;
  ipAddress: string;
  connectionDetails: string;
}

type TestPrintStatus =
  | { status: "pending" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; target?: string; hint?: string };

function defaultForm(printer?: PrinterDto): PrinterFormState {
  return {
    name: printer?.name ?? "",
    ipAddress: printer?.ipAddress ?? "",
    connectionDetails: printer?.connectionDetails ?? "",
  };
}

// ---------------------------------------------------------------------------
// PrinterFormModal
// ---------------------------------------------------------------------------

interface PrinterFormModalProps {
  editing: PrinterDto | null;
  onClose: () => void;
  onSave: (form: PrinterFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function PrinterFormModal({ editing, onClose, onSave, saving, saveError }: PrinterFormModalProps) {
  const [form, setForm] = useState<PrinterFormState>(defaultForm(editing ?? undefined));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof PrinterFormState>(key: K, value: PrinterFormState[K]) {
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
          {editing ? "Drucker bearbeiten" : "Neuer Drucker"}
        </h3>
        <p className="modal-subtitle">
          {editing
            ? `ID ${editing.id} · Felder anpassen.`
            : "Bondrucker über Netzwerk hinzufügen."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="printer-name">
              Name <span className="required-star">*</span>
            </label>
            <input
              id="printer-name"
              ref={nameRef}
              className="form-input"
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={100}
              placeholder="z. B. Küchendrucker"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="printer-ip">
              IP-Adresse <span className="required-star">*</span>
            </label>
            <input
              id="printer-ip"
              className="form-input"
              type="text"
              value={form.ipAddress}
              onChange={(e) => set("ipAddress", e.target.value)}
              required
              placeholder="z. B. 192.168.1.100"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="printer-details">
              Verbindungsdetails
            </label>
            <input
              id="printer-details"
              className="form-input"
              type="text"
              value={form.connectionDetails}
              onChange={(e) => set("connectionDetails", e.target.value)}
              maxLength={500}
              placeholder="Optional"
            />
            <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
              Port, Zeichensatz o. Ä.
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
  printer: PrinterDto;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}

function DeleteConfirmModal({ printer, onClose, onConfirm, deleting, error }: DeleteConfirmModalProps) {
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
        <h3 className="modal-title">Drucker löschen</h3>
        <p className="modal-subtitle">„{printer.name}" wird unwiderruflich entfernt.</p>
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
// PrintersPage
// ---------------------------------------------------------------------------

export function PrintersPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [printers, setPrinters] = useState<PrinterDto[]>([]);

  const [editTarget, setEditTarget] = useState<PrinterDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PrinterDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [testStates, setTestStates] = useState<Map<number, TestPrintStatus>>(new Map());

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { printers: list } = await api.printers.list();
      setPrinters(list);
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

  async function handleSave(form: PrinterFormState) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editTarget === "new") {
        const created = await api.printers.create({
          name: form.name.trim(),
          ipAddress: form.ipAddress.trim(),
          ...(form.connectionDetails.trim() !== "" && {
            connectionDetails: form.connectionDetails.trim(),
          }),
        });
        setPrinters((prev) => [...prev, created]);
      } else if (editTarget) {
        const updated = await api.printers.update(editTarget.id, {
          name: form.name.trim(),
          ipAddress: form.ipAddress.trim(),
          connectionDetails: form.connectionDetails.trim(),
        });
        setPrinters((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
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
      await api.printers.delete(deleteTarget.id);
      setPrinters((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof ApiConflictError) {
        setDeleteError(
          "Dieser Drucker ist noch einer Menükategorie zugeordnet. " +
            "Entfernen Sie zuerst den Drucker aus der Kategorie und versuchen Sie es erneut.",
        );
      } else {
        setDeleteError(err instanceof Error ? err.message : "Fehler beim Löschen.");
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── Test Print ────────────────────────────────────────────────────────────

  async function handleTestPrint(printer: PrinterDto) {
    setTestStates((prev) => new Map(prev).set(printer.id, { status: "pending" }));
    try {
      const result = await api.printers.testPrint(printer.id);
      setTestStates((prev) =>
        new Map(prev).set(printer.id, { status: "ok", message: result.message }),
      );
    } catch (err) {
      if (err instanceof ApiPrinterError) {
        setTestStates((prev) =>
          new Map(prev).set(printer.id, {
            status: "error",
            message: err.message,
            target: err.target,
            hint: err.hint,
          }),
        );
      } else {
        setTestStates((prev) =>
          new Map(prev).set(printer.id, {
            status: "error",
            message: err instanceof Error ? err.message : "Testdruck fehlgeschlagen.",
          }),
        );
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Drucker</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Drucker</h1>
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
        <h1 className="page-title">Drucker</h1>
        <button
          className="btn-primary"
          style={{ width: "auto" }}
          onClick={() => {
            setSaveError(null);
            setEditTarget("new");
          }}
        >
          + Neuer Drucker
        </button>
      </div>

      {printers.length === 0 ? (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">Noch keine Drucker konfiguriert.</p>
          <button
            className="btn-primary"
            style={{ marginTop: 14 }}
            onClick={() => {
              setSaveError(null);
              setEditTarget("new");
            }}
          >
            Drucker hinzufügen
          </button>
        </div>
      ) : (
        <div className="printers-list">
          <div className="printers-row printers-row--header">
            <span className="printers-col-name">Name</span>
            <span className="printers-col-ip">IP-Adresse</span>
            <span className="printers-col-details">Verbindungsdetails</span>
            <span className="printers-col-status" />
            <span className="printers-col-actions" />
          </div>

          {printers.map((printer) => {
            const testState = testStates.get(printer.id);
            return (
              <div key={printer.id} className="printers-item">
                <div className="printers-row">
                  <span className="printers-col-name">{printer.name}</span>
                  <span className="printers-col-ip">{printer.ipAddress}</span>
                  <span className="printers-col-details">
                    {printer.connectionDetails || (
                      <span className="muted">—</span>
                    )}
                  </span>
                  <span className="printers-col-status">
                    {testState?.status === "pending" && (
                      <span className="printers-status printers-status--pending">Druckt…</span>
                    )}
                    {testState?.status === "ok" && (
                      <span className="printers-status printers-status--ok">✓ OK</span>
                    )}
                    {testState?.status === "error" && (
                      <span className="printers-status printers-status--error">Fehler</span>
                    )}
                  </span>
                  <span className="printers-col-actions">
                    <button
                      className="btn-icon"
                      title="Testdruck senden"
                      disabled={testState?.status === "pending"}
                      onClick={() => handleTestPrint(printer)}
                    >
                      🖨
                    </button>
                    <button
                      className="btn-icon"
                      title="Bearbeiten"
                      onClick={() => {
                        setSaveError(null);
                        setEditTarget(printer);
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-icon btn-icon--danger"
                      title="Löschen"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(printer);
                      }}
                    >
                      🗑
                    </button>
                  </span>
                </div>

                {testState?.status === "error" && (
                  <div className="printers-error-banner">
                    <span className="printers-error-banner__line">
                      {testState.target ? (
                        <strong>{testState.target}</strong>
                      ) : null}
                      {testState.target ? ": " : ""}
                      {testState.message}
                    </span>
                    {testState.hint && (
                      <span className="printers-error-banner__hint">{testState.hint}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editTarget != null && (
        <PrinterFormModal
          editing={editTarget === "new" ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
          saving={saving}
          saveError={saveError}
        />
      )}

      {deleteTarget != null && (
        <DeleteConfirmModal
          printer={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
}
