import { useCallback, useEffect, useRef, useState } from "react";
import type { TableDto } from "@serva/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface SingleFormState {
  name: string;
  weight: string;
  isLocked: boolean;
}

interface BulkFormState {
  rowsRaw: string;
  from: string;
  to: string;
  lockNew: boolean;
}

function defaultSingleForm(table?: TableDto): SingleFormState {
  if (!table) {
    return { name: "", weight: "", isLocked: false };
  }
  return {
    name: table.name,
    weight: String(table.weight),
    isLocked: table.isLocked,
  };
}

function defaultBulkForm(): BulkFormState {
  return { rowsRaw: "", from: "1", to: "5", lockNew: false };
}

function parseRows(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

interface BulkPreview {
  rows: string[];
  from: number;
  to: number;
  count: number;
  sample: string[];
  /** Validation message — empty when the form is valid. */
  error: string;
}

function computeBulkPreview(form: BulkFormState): BulkPreview {
  const rows = parseRows(form.rowsRaw);
  const from = parseInt(form.from, 10);
  const to = parseInt(form.to, 10);

  if (rows.length === 0) {
    return { rows, from, to, count: 0, sample: [], error: "Mindestens eine Zeile angeben." };
  }
  if (!Number.isFinite(from) || from < 1) {
    return { rows, from, to, count: 0, sample: [], error: 'Wert für „Von" muss mindestens 1 sein.' };
  }
  if (!Number.isFinite(to) || to < from) {
    return { rows, from, to, count: 0, sample: [], error: 'Wert für „Bis" muss größer oder gleich „Von" sein.' };
  }

  const names: string[] = [];
  for (const row of rows) {
    for (let n = from; n <= to; n += 1) {
      names.push(`${row}${n}`);
    }
  }
  const sample =
    names.length <= 6
      ? names
      : [...names.slice(0, 3), "…", ...names.slice(-3)];

  return {
    rows,
    from,
    to,
    count: names.length,
    sample,
    error: "",
  };
}

// ---------------------------------------------------------------------------
// SingleTableModal
// ---------------------------------------------------------------------------

interface SingleTableModalProps {
  editing: TableDto | null;
  onClose: () => void;
  onSave: (form: SingleFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function SingleTableModal({
  editing,
  onClose,
  onSave,
  saving,
  saveError,
}: SingleTableModalProps) {
  const [form, setForm] = useState<SingleFormState>(defaultSingleForm(editing ?? undefined));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof SingleFormState>(key: K, value: SingleFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const weightValid = form.weight === "" || /^-?\d+$/.test(form.weight);
  const canSubmit = form.name.trim() !== "" && weightValid;

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
        <h3 className="modal-title">
          {editing ? "Tisch bearbeiten" : "Neuer Tisch"}
        </h3>
        <p className="modal-subtitle">
          {editing
            ? `ID ${editing.id} · Felder anpassen.`
            : "Wird einzeln erstellt."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="table-name">
              Name <span className="required-star">*</span>
            </label>
            <input
              id="table-name"
              ref={nameRef}
              className="form-input"
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={100}
              placeholder="z. B. A1"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="table-weight">
              Gewichtung
            </label>
            <input
              id="table-weight"
              className="form-input"
              type="number"
              value={form.weight}
              onChange={(e) => set("weight", e.target.value)}
              placeholder="0"
            />
            <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
              Niedrigere Werte erscheinen zuerst.
            </span>
          </div>

          <div className="form-group cat-checkbox-group">
            <label className="form-label" htmlFor="table-locked">
              Status
            </label>
            <label className="cat-checkbox-label" htmlFor="table-locked">
              <input
                id="table-locked"
                type="checkbox"
                checked={form.isLocked}
                onChange={(e) => set("isLocked", e.target.checked)}
              />
              Gesperrt
            </label>
            <span className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Gesperrte Tische erscheinen nicht in der Kellner-Auswahl.
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
// BulkTableModal
// ---------------------------------------------------------------------------

interface BulkTableModalProps {
  onClose: () => void;
  onSave: (form: BulkFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function BulkTableModal({ onClose, onSave, saving, saveError }: BulkTableModalProps) {
  const [form, setForm] = useState<BulkFormState>(defaultBulkForm());
  const rowsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => rowsRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof BulkFormState>(key: K, value: BulkFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const preview = computeBulkPreview(form);
  const canSubmit = preview.error === "" && preview.count > 0;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" style={{ width: 480 }}>
        <h3 className="modal-title">Tische im Bulk anlegen</h3>
        <p className="modal-subtitle">
          Zeilen × Bereich – z. B. „A,B,C,D,E" und 1–5 ergibt 25 Tische A1…E5.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="bulk-rows">
              Zeilen <span className="required-star">*</span>
            </label>
            <input
              id="bulk-rows"
              ref={rowsRef}
              className="form-input"
              type="text"
              value={form.rowsRaw}
              onChange={(e) => set("rowsRaw", e.target.value)}
              placeholder="A,B,C,D,E"
              required
            />
            <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
              Komma- oder leerzeichen-getrennt.
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="bulk-from">
                Von <span className="required-star">*</span>
              </label>
              <input
                id="bulk-from"
                className="form-input"
                type="number"
                min={1}
                value={form.from}
                onChange={(e) => set("from", e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="bulk-to">
                Bis <span className="required-star">*</span>
              </label>
              <input
                id="bulk-to"
                className="form-input"
                type="number"
                min={1}
                value={form.to}
                onChange={(e) => set("to", e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group cat-checkbox-group">
            <label className="form-label" htmlFor="bulk-locked">
              Status
            </label>
            <label className="cat-checkbox-label" htmlFor="bulk-locked">
              <input
                id="bulk-locked"
                type="checkbox"
                checked={form.lockNew}
                onChange={(e) => set("lockNew", e.target.checked)}
              />
              Neu erstellte Tische sperren
            </label>
          </div>

          <div className="tables-bulk-preview">
            {preview.error ? (
              <span style={{ color: "#b91c1c" }}>{preview.error}</span>
            ) : (
              <>
                <div>
                  <span className="tables-bulk-preview__count">{preview.count}</span>{" "}
                  Tische werden erstellt
                  {preview.rows.length > 0 && preview.from <= preview.to && (
                    <>
                      {" "}({preview.rows.length} ×{" "}
                      {preview.to - preview.from + 1})
                    </>
                  )}
                </div>
                <div className="tables-bulk-preview__sample">
                  {preview.sample.join(", ")}
                </div>
              </>
            )}
          </div>

          {saveError && <p className="form-error" style={{ marginTop: 12 }}>{saveError}</p>}

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
              {saving ? "Wird erstellt…" : `${preview.count} Tische erstellen`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TablesPage
// ---------------------------------------------------------------------------

export function TablesPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tables, setTables] = useState<TableDto[]>([]);

  // Single create / edit modal
  const [editTarget, setEditTarget] = useState<TableDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Bulk modal
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Reorder state
  const [reordering, setReordering] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { tables: list } = await api.tables.list();
      setTables(list);
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

  // ── Create / Update ──────────────────────────────────────────────────────

  async function handleSaveSingle(form: SingleFormState) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editTarget === "new") {
        const created = await api.tables.create({
          name: form.name.trim(),
          ...(form.weight !== "" && { weight: parseInt(form.weight, 10) }),
          ...(form.isLocked && { isLocked: true }),
        });
        setTables((prev) => sortTables([...prev, created]));
      } else if (editTarget) {
        const updated = await api.tables.update(editTarget.id, {
          name: form.name.trim(),
          ...(form.weight !== "" && { weight: parseInt(form.weight, 10) }),
          isLocked: form.isLocked,
        });
        setTables((prev) =>
          sortTables(prev.map((t) => (t.id === updated.id ? updated : t))),
        );
      }
      setEditTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBulk(form: BulkFormState) {
    setBulkSaving(true);
    setBulkError(null);
    try {
      const preview = computeBulkPreview(form);
      if (preview.error) throw new Error(preview.error);

      const { tables: created } = await api.tables.bulkCreate({
        rows: preview.rows,
        from: preview.from,
        to: preview.to,
        ...(form.lockNew && { lockNew: true }),
      });
      setTables((prev) => sortTables([...prev, ...created]));
      setBulkOpen(false);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Fehler beim Erstellen.");
    } finally {
      setBulkSaving(false);
    }
  }

  // ── Lock toggle (optimistic) ─────────────────────────────────────────────

  async function handleToggleLock(table: TableDto) {
    const previous = tables;
    const optimistic = { ...table, isLocked: !table.isLocked };
    setTables((prev) => prev.map((t) => (t.id === table.id ? optimistic : t)));
    try {
      const result = await api.tables.update(table.id, { isLocked: !table.isLocked });
      setTables((prev) => prev.map((t) => (t.id === result.id ? result : t)));
    } catch {
      setTables(previous);
    }
  }

  // ── Reorder via ▲/▼ buttons ──────────────────────────────────────────────

  async function moveTable(idx: number, direction: -1 | 1) {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= tables.length) return;

    const reordered = [...tables];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const withWeights = reordered.map((t, i) => ({ ...t, weight: (i + 1) * 10 }));

    const previous = tables;
    setTables(withWeights);
    setReordering(true);
    try {
      await Promise.all([
        api.tables.update(withWeights[idx].id,     { weight: withWeights[idx].weight }),
        api.tables.update(withWeights[swapIdx].id, { weight: withWeights[swapIdx].weight }),
      ]);
    } catch {
      setTables(previous);
    } finally {
      setReordering(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Tische</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Tische</h1>
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
        <h1 className="page-title">Tische</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-secondary"
            style={{ width: "auto" }}
            onClick={() => {
              setBulkError(null);
              setBulkOpen(true);
            }}
          >
            + Bulk anlegen
          </button>
          <button
            className="btn-primary"
            style={{ width: "auto" }}
            onClick={() => {
              setSaveError(null);
              setEditTarget("new");
            }}
          >
            + Neuer Tisch
          </button>
        </div>
      </div>

      {tables.length === 0 ? (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">Noch keine Tische vorhanden.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            <button
              className="btn-secondary"
              onClick={() => {
                setSaveError(null);
                setEditTarget("new");
              }}
            >
              Einzelnen Tisch erstellen
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setBulkError(null);
                setBulkOpen(true);
              }}
            >
              Bulk anlegen
            </button>
          </div>
        </div>
      ) : (
        <div className="tables-list" aria-busy={reordering ? "true" : "false"}>
          <div className="tables-row tables-row--header">
            <span className="tables-col-handle" />
            <span className="tables-col-name">Name</span>
            <span className="tables-col-weight">Gewicht</span>
            <span className="tables-col-status">Status</span>
            <span className="tables-col-actions" />
          </div>

          {tables.map((table, idx) => (
            <div key={table.id} className="tables-row">
              <span className="tables-col-handle">
                <button
                  type="button"
                  className="menu-reorder-btn"
                  disabled={idx === 0 || reordering}
                  onClick={() => moveTable(idx, -1)}
                  title="Nach oben"
                  aria-label="Nach oben"
                >▲</button>
                <button
                  type="button"
                  className="menu-reorder-btn"
                  disabled={idx === tables.length - 1 || reordering}
                  onClick={() => moveTable(idx, 1)}
                  title="Nach unten"
                  aria-label="Nach unten"
                >▼</button>
              </span>
              <span className="tables-col-name">{table.name}</span>
              <span className="tables-col-weight">{table.weight}</span>
              <span className="tables-col-status">
                {table.isLocked ? (
                  <span className="badge-locked">Gesperrt</span>
                ) : (
                  <span className="badge-unlocked">Aktiv</span>
                )}
              </span>
              <span className="tables-col-actions">
                <button
                  className={`btn-icon${table.isLocked ? " btn-icon--unlock" : ""}`}
                  title={table.isLocked ? "Entsperren" : "Sperren"}
                  onClick={() => handleToggleLock(table)}
                >
                  {table.isLocked ? "🔓" : "🔒"}
                </button>
                <button
                  className="btn-icon"
                  title="Bearbeiten"
                  onClick={() => {
                    setSaveError(null);
                    setEditTarget(table);
                  }}
                >
                  ✏️
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {editTarget != null && (
        <SingleTableModal
          editing={editTarget === "new" ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSaveSingle}
          saving={saving}
          saveError={saveError}
        />
      )}

      {bulkOpen && (
        <BulkTableModal
          onClose={() => setBulkOpen(false)}
          onSave={handleSaveBulk}
          saving={bulkSaving}
          saveError={bulkError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortTables(list: TableDto[]): TableDto[] {
  return [...list].sort(
    (a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "de"),
  );
}
