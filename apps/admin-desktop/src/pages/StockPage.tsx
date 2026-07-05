import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MenuItemDto,
  MenuItemStockRequirementDto,
  StockItemDto,
} from "@bstoema/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface CreateFormState {
  name: string;
  quantity: string;
}

type EditMode = "absolute" | "delta";

interface EditFormState {
  mode: EditMode;
  quantity: string;
  delta: string;
}

// Legacy "serva" prefix kept so saved thresholds survive the BstöMa rebrand.
const THRESHOLD_STORAGE_KEY = "serva.stockLowThreshold";
const DEFAULT_THRESHOLD = 5;

function loadThreshold(): number {
  try {
    const raw = localStorage.getItem(THRESHOLD_STORAGE_KEY);
    if (raw == null) return DEFAULT_THRESHOLD;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return DEFAULT_THRESHOLD;
    return n;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

// ---------------------------------------------------------------------------
// CreateModal
// ---------------------------------------------------------------------------

interface CreateModalProps {
  onClose: () => void;
  onSave: (form: CreateFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function CreateModal({ onClose, onSave, saving, saveError }: CreateModalProps) {
  const [form, setForm] = useState<CreateFormState>({ name: "", quantity: "0" });
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const qtyNum = parseInt(form.quantity, 10);
  const qtyValid = form.quantity !== "" && !isNaN(qtyNum) && qtyNum >= 0;
  const canSubmit = form.name.trim() !== "" && qtyValid;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" style={{ width: 440 }}>
        <h3 className="modal-title">Neuer Lagerartikel</h3>
        <p className="modal-subtitle">Wird dem Lager hinzugefügt.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="stock-name">
              Name <span className="required-star">*</span>
            </label>
            <input
              id="stock-name"
              ref={nameRef}
              className="form-input"
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
              maxLength={100}
              placeholder="z. B. Bierfass 50l"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="stock-quantity">
              Anfangsmenge <span className="required-star">*</span>
            </label>
            <input
              id="stock-quantity"
              className="form-input"
              type="number"
              min={0}
              step="1"
              value={form.quantity}
              onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
              required
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
// EditModal — set absolute quantity OR apply delta
// ---------------------------------------------------------------------------

interface EditModalProps {
  item: StockItemDto;
  onClose: () => void;
  onSave: (form: EditFormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function EditModal({ item, onClose, onSave, saving, saveError }: EditModalProps) {
  const [form, setForm] = useState<EditFormState>({
    mode: "absolute",
    quantity: String(item.quantity),
    delta: "",
  });

  const qtyNum = parseInt(form.quantity, 10);
  const qtyValid = form.quantity !== "" && !isNaN(qtyNum) && qtyNum >= 0;
  const deltaNum = parseInt(form.delta, 10);
  const deltaValid = form.delta !== "" && !isNaN(deltaNum) && deltaNum !== 0;
  const canSubmit = form.mode === "absolute" ? qtyValid : deltaValid;

  const projected =
    form.mode === "delta" && deltaValid
      ? Math.max(0, item.quantity + deltaNum)
      : null;

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
        <h3 className="modal-title">Lagerartikel bearbeiten</h3>
        <p className="modal-subtitle">
          „{item.name}" · Aktueller Bestand: <strong>{item.quantity}</strong>
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          <div className="form-group">
            <label className="form-label">Aktion</label>
            <div className="stock-mode-toggle">
              <button
                type="button"
                className={
                  form.mode === "absolute"
                    ? "btn-secondary items-sort-active"
                    : "btn-secondary"
                }
                onClick={() => setForm((p) => ({ ...p, mode: "absolute" }))}
              >
                Menge setzen
              </button>
              <button
                type="button"
                className={
                  form.mode === "delta"
                    ? "btn-secondary items-sort-active"
                    : "btn-secondary"
                }
                onClick={() => setForm((p) => ({ ...p, mode: "delta" }))}
              >
                Änderung (±)
              </button>
            </div>
          </div>

          {form.mode === "absolute" ? (
            <div className="form-group">
              <label className="form-label" htmlFor="stock-edit-qty">
                Neue Menge
              </label>
              <input
                id="stock-edit-qty"
                className="form-input"
                type="number"
                min={0}
                step="1"
                value={form.quantity}
                onChange={(e) =>
                  setForm((p) => ({ ...p, quantity: e.target.value }))
                }
                required
              />
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" htmlFor="stock-edit-delta">
                Änderung
              </label>
              <input
                id="stock-edit-delta"
                className="form-input"
                type="number"
                step="1"
                value={form.delta}
                onChange={(e) => setForm((p) => ({ ...p, delta: e.target.value }))}
                placeholder="z. B. -3 oder 10"
                required
              />
              {projected != null && (
                <span className="muted" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                  Neuer Bestand: <strong>{projected}</strong>
                </span>
              )}
            </div>
          )}

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
// RequirementsEditor — per-menu-item stock requirement editor
// ---------------------------------------------------------------------------

interface RequirementsEditorProps {
  menuItems: MenuItemDto[];
  stockItems: StockItemDto[];
  selectedMenuItemId: number | null;
  onSelectMenuItem: (id: number | null) => void;
  requirements: MenuItemStockRequirementDto[];
  setRequirements: (next: MenuItemStockRequirementDto[]) => void;
  onSave: () => Promise<void>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  dirty: boolean;
}

function RequirementsEditor({
  menuItems,
  stockItems,
  selectedMenuItemId,
  onSelectMenuItem,
  requirements,
  setRequirements,
  onSave,
  loading,
  saving,
  error,
  dirty,
}: RequirementsEditorProps) {
  function setRow(index: number, patch: Partial<MenuItemStockRequirementDto>) {
    setRequirements(
      requirements.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(index: number) {
    setRequirements(requirements.filter((_, i) => i !== index));
  }

  function addRow() {
    const usedIds = new Set(requirements.map((r) => r.stockItemId));
    const firstFree = stockItems.find((s) => !usedIds.has(s.id));
    if (!firstFree) return;
    setRequirements([
      ...requirements,
      { stockItemId: firstFree.id, quantityRequired: 1 },
    ]);
  }

  const canAddMore = requirements.length < stockItems.length;

  return (
    <div className="stock-req-card">
      <div className="stock-req-header">
        <h2 className="stock-req-title">Menü-Anforderungen</h2>
        <select
          className="form-input"
          style={{ maxWidth: 320 }}
          value={selectedMenuItemId == null ? "" : String(selectedMenuItemId)}
          onChange={(e) =>
            onSelectMenuItem(
              e.target.value === "" ? null : parseInt(e.target.value, 10),
            )
          }
        >
          <option value="">— Artikel wählen —</option>
          {menuItems.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {selectedMenuItemId == null ? (
        <p className="muted" style={{ padding: "16px 0" }}>
          Wählen Sie einen Artikel, um dessen Lageranforderungen zu bearbeiten.
        </p>
      ) : loading ? (
        <div className="overview-loading">Wird geladen…</div>
      ) : (
        <>
          {requirements.length === 0 ? (
            <p className="muted" style={{ padding: "12px 0" }}>
              Keine Lageranforderungen für diesen Artikel.
            </p>
          ) : (
            <div className="stock-req-list">
              {requirements.map((row, i) => (
                <div key={i} className="stock-req-row">
                  <select
                    className="form-input"
                    value={String(row.stockItemId)}
                    onChange={(e) =>
                      setRow(i, { stockItemId: parseInt(e.target.value, 10) })
                    }
                  >
                    {stockItems.map((s) => (
                      <option
                        key={s.id}
                        value={String(s.id)}
                        disabled={
                          s.id !== row.stockItemId &&
                          requirements.some((r) => r.stockItemId === s.id)
                        }
                      >
                        {s.name} (Bestand: {s.quantity})
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    step="1"
                    value={row.quantityRequired}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setRow(i, { quantityRequired: isNaN(n) || n < 1 ? 1 : n });
                    }}
                  />
                  <button
                    type="button"
                    className="btn-icon btn-icon--danger"
                    title="Zeile entfernen"
                    onClick={() => removeRow(i)}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="stock-req-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={addRow}
              disabled={!canAddMore}
            >
              + Anforderung hinzufügen
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onSave}
              disabled={!dirty || saving}
            >
              {saving ? "Wird gespeichert…" : "Speichern"}
            </button>
          </div>

          {error && <p className="form-error">{error}</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StockPage
// ---------------------------------------------------------------------------

export function StockPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [stockItems, setStockItems] = useState<StockItemDto[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemDto[]>([]);

  // Low-stock threshold (UI-only, persisted in localStorage)
  const [threshold, setThreshold] = useState<number>(loadThreshold());

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal
  const [editTarget, setEditTarget] = useState<StockItemDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Inline quick-adjust busy ids
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  // Requirements editor
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<number | null>(null);
  const [reqOriginal, setReqOriginal] = useState<MenuItemStockRequirementDto[]>([]);
  const [reqDraft, setReqDraft] = useState<MenuItemStockRequirementDto[]>([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  // ── Load lists ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [{ items: stock }, { items: menu }] = await Promise.all([
        api.stock.listItems(),
        api.menu.listItems(),
      ]);
      setStockItems(stock);
      setMenuItems(menu);
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

  // ── Threshold persistence ───────────────────────────────────────────────

  function handleThresholdChange(value: string) {
    if (value === "") {
      setThreshold(0);
      try {
        localStorage.setItem(THRESHOLD_STORAGE_KEY, "0");
      } catch {
        /* ignore */
      }
      return;
    }
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return;
    setThreshold(n);
    try {
      localStorage.setItem(THRESHOLD_STORAGE_KEY, String(n));
    } catch {
      /* ignore */
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate(form: CreateFormState) {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.stock.createItem({
        name: form.name.trim(),
        quantity: parseInt(form.quantity, 10),
      });
      setStockItems((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "de")),
      );
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setCreating(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  async function handleEdit(form: EditFormState) {
    if (!editTarget) return;
    setEditing(true);
    setEditError(null);
    try {
      const body =
        form.mode === "absolute"
          ? { quantity: parseInt(form.quantity, 10) }
          : { delta: parseInt(form.delta, 10) };
      const updated = await api.stock.updateItem(editTarget.id, body);
      setStockItems((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
      setEditTarget(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setEditing(false);
    }
  }

  // ── Inline quick-adjust ───────────────────────────────────────────────────

  async function handleQuickDelta(item: StockItemDto, delta: number) {
    if (item.quantity + delta < 0 && delta < 0) return;
    setBusyIds((prev) => new Set(prev).add(item.id));
    try {
      const updated = await api.stock.updateItem(item.id, { delta });
      setStockItems((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
    } catch {
      /* surface in row? — keep silent like printers test failures */
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  // ── Requirements load on menu-item select ────────────────────────────────

  useEffect(() => {
    if (selectedMenuItemId == null) {
      setReqOriginal([]);
      setReqDraft([]);
      setReqError(null);
      return;
    }
    let cancelled = false;
    setReqLoading(true);
    setReqError(null);
    api.stock
      .getMenuItemRequirements(selectedMenuItemId)
      .then((res) => {
        if (cancelled) return;
        setReqOriginal(res.requirements);
        setReqDraft(res.requirements);
      })
      .catch((err) => {
        if (cancelled) return;
        setReqError(err instanceof Error ? err.message : "Fehler beim Laden.");
      })
      .finally(() => {
        if (!cancelled) setReqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedMenuItemId]);

  async function handleReqSave() {
    if (selectedMenuItemId == null) return;
    setReqSaving(true);
    setReqError(null);
    try {
      const res = await api.stock.replaceMenuItemRequirements(selectedMenuItemId, {
        requirements: reqDraft,
      });
      setReqOriginal(res.requirements);
      setReqDraft(res.requirements);
    } catch (err) {
      setReqError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setReqSaving(false);
    }
  }

  const reqDirty = JSON.stringify(reqOriginal) !== JSON.stringify(reqDraft);

  // ── Render ────────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Lager</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Lager</h1>
        </div>
        <p className="form-error">{state.message}</p>
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  const sorted = [...stockItems].sort((a, b) =>
    a.name.localeCompare(b.name, "de"),
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Lager</h1>
        <button
          className="btn-primary"
          style={{ width: "auto" }}
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
          + Neuer Lagerartikel
        </button>
      </div>

      {/* Threshold toolbar */}
      <div className="stock-toolbar">
        <label className="stock-threshold-label" htmlFor="stock-threshold">
          Schwelle „niedrig":
        </label>
        <input
          id="stock-threshold"
          className="form-input stock-threshold-input"
          type="number"
          min={0}
          step="1"
          value={threshold}
          onChange={(e) => handleThresholdChange(e.target.value)}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          Artikel mit Bestand unter dieser Schwelle werden hervorgehoben.
        </span>
      </div>

      {/* Stock items list */}
      {sorted.length === 0 ? (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">Noch keine Lagerartikel vorhanden.</p>
          <button
            className="btn-primary"
            style={{ marginTop: 14 }}
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            Ersten Lagerartikel erstellen
          </button>
        </div>
      ) : (
        <div className="stock-list">
          <div className="stock-row stock-row--header">
            <span className="stock-col-name">Name</span>
            <span className="stock-col-qty">Bestand</span>
            <span className="stock-col-status">Status</span>
            <span className="stock-col-actions" />
          </div>

          {sorted.map((item) => {
            const isLow = item.quantity < threshold;
            const isOut = item.quantity === 0;
            const busy = busyIds.has(item.id);
            return (
              <div key={item.id} className="stock-row">
                <span className="stock-col-name">{item.name}</span>
                <span className="stock-col-qty">{item.quantity}</span>
                <span className="stock-col-status">
                  {isOut ? (
                    <span className="badge-stock-out">Leer</span>
                  ) : isLow ? (
                    <span className="badge-stock-low">Niedrig</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>OK</span>
                  )}
                </span>
                <span className="stock-col-actions">
                  <button
                    className="btn-icon"
                    title="−1"
                    disabled={busy || item.quantity === 0}
                    onClick={() => handleQuickDelta(item, -1)}
                  >
                    −
                  </button>
                  <button
                    className="btn-icon"
                    title="+1"
                    disabled={busy}
                    onClick={() => handleQuickDelta(item, 1)}
                  >
                    +
                  </button>
                  <button
                    className="btn-icon"
                    title="Bearbeiten"
                    onClick={() => {
                      setEditError(null);
                      setEditTarget(item);
                    }}
                  >
                    ✏️
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Requirements editor */}
      <RequirementsEditor
        menuItems={menuItems}
        stockItems={sorted}
        selectedMenuItemId={selectedMenuItemId}
        onSelectMenuItem={setSelectedMenuItemId}
        requirements={reqDraft}
        setRequirements={setReqDraft}
        onSave={handleReqSave}
        loading={reqLoading}
        saving={reqSaving}
        error={reqError}
        dirty={reqDirty}
      />

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onSave={handleCreate}
          saving={creating}
          saveError={createError}
        />
      )}

      {editTarget && (
        <EditModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleEdit}
          saving={editing}
          saveError={editError}
        />
      )}
    </div>
  );
}
