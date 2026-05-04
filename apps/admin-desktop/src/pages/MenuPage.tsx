import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../contexts/ApiClientContext";
import { ApiConflictError } from "@serva/api-client";
import type { MenuCategoryDto, PrinterDto } from "@serva/shared-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface FormState {
  name: string;
  description: string;
  weight: string;
  isLocked: boolean;
  printerId: string;      // "" → no printer
  orderDisplayId: string; // "" → no display
}

function defaultForm(cat?: MenuCategoryDto): FormState {
  if (!cat) {
    return {
      name: "",
      description: "",
      weight: "",
      isLocked: false,
      printerId: "",
      orderDisplayId: "",
    };
  }
  return {
    name: cat.name,
    description: cat.description,
    weight: String(cat.weight),
    isLocked: cat.isLocked,
    printerId: cat.printerId != null ? String(cat.printerId) : "",
    orderDisplayId: cat.orderDisplayId != null ? String(cat.orderDisplayId) : "",
  };
}

// ---------------------------------------------------------------------------
// CategoryModal
// ---------------------------------------------------------------------------

interface CategoryModalProps {
  editing: MenuCategoryDto | null; // null = create mode
  printers: PrinterDto[];
  onClose: () => void;
  onSave: (form: FormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function CategoryModal({
  editing,
  printers,
  onClose,
  onSave,
  saving,
  saveError,
}: CategoryModalProps) {
  const [form, setForm] = useState<FormState>(() => defaultForm(editing ?? undefined));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

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
          {editing ? "Kategorie bearbeiten" : "Neue Kategorie"}
        </h3>
        <p className="modal-subtitle">
          {editing
            ? `ID ${editing.id} · Felder leer lassen um bestehende Werte zu behalten.`
            : "Wird der Speisekarte hinzugefügt."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(form);
          }}
        >
          {/* Name */}
          <div className="form-group">
            <label className="form-label" htmlFor="cat-name">
              Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="cat-name"
              ref={nameRef}
              className="form-input"
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label" htmlFor="cat-description">
              Beschreibung
            </label>
            <textarea
              id="cat-description"
              className="form-input"
              style={{ resize: "vertical", minHeight: 72 }}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={500}
            />
          </div>

          {/* Weight + isLocked */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="cat-weight">
                Gewichtung
              </label>
              <input
                id="cat-weight"
                className="form-input"
                type="number"
                value={form.weight}
                onChange={(e) => set("weight", e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="form-group cat-checkbox-group">
              <label className="form-label" htmlFor="cat-locked">
                Status
              </label>
              <label className="cat-checkbox-label" htmlFor="cat-locked">
                <input
                  id="cat-locked"
                  type="checkbox"
                  checked={form.isLocked}
                  onChange={(e) => set("isLocked", e.target.checked)}
                />
                Gesperrt
              </label>
              <span className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Gesperrte Kategorien sind für Kellner unsichtbar.
              </span>
            </div>
          </div>

          {/* Printer */}
          <div className="form-group">
            <label className="form-label" htmlFor="cat-printer">
              Drucker
            </label>
            <select
              id="cat-printer"
              className="form-input"
              value={form.printerId}
              onChange={(e) => set("printerId", e.target.value)}
            >
              <option value="">— Kein Drucker —</option>
              {printers.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Order Display */}
          <div className="form-group">
            <label className="form-label" htmlFor="cat-display">
              Bestellanzeige (ID)
            </label>
            <input
              id="cat-display"
              className="form-input"
              type="number"
              min={1}
              value={form.orderDisplayId}
              onChange={(e) => set("orderDisplayId", e.target.value)}
              placeholder="— keine —"
            />
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
              disabled={saving || !form.name.trim()}
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
  category: MenuCategoryDto;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  deleting: boolean;
  deleteError: string | null;
}

function DeleteConfirmModal({
  category,
  onClose,
  onConfirm,
  deleting,
  deleteError,
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
      <div className="modal-card">
        <h3 className="modal-title">Kategorie löschen?</h3>
        <p className="modal-subtitle">
          „{category.name}" wird unwiderruflich entfernt.
        </p>

        {deleteError && (
          <div className="cat-delete-error">
            {deleteError}
          </div>
        )}

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
// MenuPage
// ---------------------------------------------------------------------------

export function MenuPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);

  // Create / edit modal
  const [editTarget, setEditTarget] = useState<MenuCategoryDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<MenuCategoryDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reorder saving indicator
  const [reordering, setReordering] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [{ categories: cats }, { printers: prts }] = await Promise.all([
        api.menu.listCategories({ includeRouting: true }),
        api.printers.list(),
      ]);
      const sorted = [...cats].sort(
        (a, b) => a.weight - b.weight || a.name.localeCompare(b.name),
      );
      setCategories(sorted);
      setPrinters(prts);
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

  // ── Create / Update ─────────────────────────────────────────────────────

  async function handleSave(form: FormState) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editTarget === "new") {
        const body = {
          name: form.name.trim(),
          ...(form.description.trim() && { description: form.description.trim() }),
          ...(form.weight !== "" && { weight: parseInt(form.weight, 10) }),
          ...(form.isLocked && { isLocked: true }),
          ...(form.printerId !== "" && { printerId: parseInt(form.printerId, 10) }),
          ...(form.orderDisplayId !== "" && {
            orderDisplayId: parseInt(form.orderDisplayId, 10),
          }),
        };
        const created = await api.menu.createCategory(body);
        setCategories((prev) =>
          [...prev, created].sort(
            (a, b) => a.weight - b.weight || a.name.localeCompare(b.name),
          ),
        );
      } else if (editTarget) {
        const body = {
          name: form.name.trim(),
          description: form.description.trim(),
          isLocked: form.isLocked,
          ...(form.weight !== "" && { weight: parseInt(form.weight, 10) }),
          ...(form.printerId !== "" && { printerId: parseInt(form.printerId, 10) }),
          ...(form.orderDisplayId !== "" && {
            orderDisplayId: parseInt(form.orderDisplayId, 10),
          }),
        };
        const updated = await api.menu.updateCategory(editTarget.id, body);
        setCategories((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c)),
        );
      }
      setEditTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.menu.deleteCategory(deleteTarget.id);
      setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof ApiConflictError) {
        setDeleteError(
          "Diese Kategorie enthält noch Artikel. Bitte alle Artikel löschen oder in eine andere Kategorie verschieben, bevor die Kategorie gelöscht wird.",
        );
      } else {
        setDeleteError(err instanceof Error ? err.message : "Fehler beim Löschen.");
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── Lock / Unlock toggle ─────────────────────────────────────────────────

  async function handleToggleLock(cat: MenuCategoryDto) {
    // Optimistic update
    const toggled = { ...cat, isLocked: !cat.isLocked };
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? toggled : c)));
    try {
      const result = await api.menu.updateCategory(cat.id, {
        isLocked: !cat.isLocked,
      });
      setCategories((prev) => prev.map((c) => (c.id === result.id ? result : c)));
    } catch {
      // Rollback on failure
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
    }
  }

  // ── Move up / move down ──────────────────────────────────────────────────

  async function moveCategory(idx: number, direction: -1 | 1) {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= categories.length) return;

    // Swap the two items in local state immediately (optimistic)
    const reordered = [...categories];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const withWeights = reordered.map((c, i) => ({ ...c, weight: (i + 1) * 10 }));
    setCategories(withWeights);

    // PATCH only the two swapped rows
    setReordering(true);
    try {
      await Promise.all([
        api.menu.updateCategory(withWeights[idx].id,    { weight: withWeights[idx].weight }),
        api.menu.updateCategory(withWeights[swapIdx].id, { weight: withWeights[swapIdx].weight }),
      ]);
    } catch {
      load(); // reload on failure
    } finally {
      setReordering(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function printerLabel(printerId?: number): string {
    if (printerId == null) return "—";
    return printers.find((p) => p.id === printerId)?.name ?? `ID ${printerId}`;
  }

  function openCreate() {
    setSaveError(null);
    setEditTarget("new");
  }

  function openEdit(cat: MenuCategoryDto) {
    setSaveError(null);
    setEditTarget(cat);
  }

  function openDelete(cat: MenuCategoryDto) {
    setDeleteError(null);
    setDeleteTarget(cat);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Speisekarte</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Speisekarte</h1>
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
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Speisekarte — Kategorien</h1>
          {reordering && (
            <span className="muted" style={{ fontSize: 12, marginTop: 2, display: "block" }}>
              Reihenfolge wird gespeichert…
            </span>
          )}
        </div>
        <button
          className="btn-primary"
          style={{ width: "auto" }}
          onClick={openCreate}
        >
          + Neue Kategorie
        </button>
      </div>

      {/* Empty state */}
      {categories.length === 0 && (
        <div
          className="overview-card"
          style={{ textAlign: "center", padding: "40px 24px" }}
        >
          <p className="muted">
            Noch keine Kategorien vorhanden.
          </p>
          <button
            className="btn-secondary"
            style={{ marginTop: 14 }}
            onClick={openCreate}
          >
            Erste Kategorie erstellen
          </button>
        </div>
      )}

      {/* Category list */}
      {categories.length > 0 && (
        <div className="cat-list">
          {/* Header row */}
          <div className="cat-row cat-row--header">
            <span className="cat-col-handle">Reihenf.</span>
            <span className="cat-col-name">Name</span>
            <span className="cat-col-desc">Beschreibung</span>
            <span className="cat-col-weight">Gewicht</span>
            <span className="cat-col-status">Status</span>
            <span className="cat-col-printer">Drucker</span>
            <span className="cat-col-display">Anzeige</span>
            <span className="cat-col-actions" />
          </div>

          {/* Data rows */}
          {categories.map((cat, idx) => (
            <div key={cat.id} className="cat-row">
              {/* Up / Down reorder buttons */}
              <span className="cat-col-handle cat-reorder-btns">
                <button
                  className="btn-icon btn-icon--reorder"
                  title="Nach oben"
                  disabled={idx === 0 || reordering}
                  onClick={() => moveCategory(idx, -1)}
                >
                  ▲
                </button>
                <button
                  className="btn-icon btn-icon--reorder"
                  title="Nach unten"
                  disabled={idx === categories.length - 1 || reordering}
                  onClick={() => moveCategory(idx, 1)}
                >
                  ▼
                </button>
              </span>

              <span className="cat-col-name cat-name-text">{cat.name}</span>

              <span className="cat-col-desc cat-desc-text">
                {cat.description || <em className="muted">—</em>}
              </span>

              <span className="cat-col-weight">{cat.weight}</span>

              <span className="cat-col-status">
                {cat.isLocked ? (
                  <span className="badge-locked">Gesperrt</span>
                ) : (
                  <span className="badge-unlocked">Aktiv</span>
                )}
              </span>

              <span className="cat-col-printer">{printerLabel(cat.printerId)}</span>

              <span className="cat-col-display">{cat.orderDisplayId ?? "—"}</span>

              <span className="cat-col-actions">
                <button
                  className={`btn-icon${cat.isLocked ? " btn-icon--unlock" : ""}`}
                  title={cat.isLocked ? "Entsperren" : "Sperren"}
                  onClick={() => handleToggleLock(cat)}
                >
                  {cat.isLocked ? "🔓" : "🔒"}
                </button>
                <button
                  className="btn-icon"
                  title="Bearbeiten"
                  onClick={() => openEdit(cat)}
                >
                  ✏️
                </button>
                <button
                  className="btn-icon btn-icon--danger"
                  title="Löschen"
                  onClick={() => openDelete(cat)}
                >
                  🗑️
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {editTarget != null && (
        <CategoryModal
          editing={editTarget === "new" ? null : editTarget}
          printers={printers}
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Delete confirm modal */}
      {deleteTarget != null && (
        <DeleteConfirmModal
          category={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
          deleteError={deleteError}
        />
      )}
    </div>
  );
}
