import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../contexts/ApiClientContext";
import type { MenuCategoryDto, MenuItemDto } from "@serva/shared-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

type SortKey = "weight,name" | undefined;

interface FormState {
  name: string;
  description: string;
  price: string;
  weight: string;
  isLocked: boolean;
  menuCategoryId: string;
}

function defaultForm(item?: MenuItemDto): FormState {
  if (!item) {
    return {
      name: "",
      description: "",
      price: "",
      weight: "",
      isLocked: false,
      menuCategoryId: "",
    };
  }
  return {
    name: item.name,
    description: item.description,
    price: String(item.price),
    weight: String(item.weight),
    isLocked: item.isLocked,
    menuCategoryId: String(item.menuCategoryId),
  };
}

function formatPrice(price: number): string {
  return price.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// ---------------------------------------------------------------------------
// ItemModal
// ---------------------------------------------------------------------------

interface ItemModalProps {
  editing: MenuItemDto | null;
  categories: MenuCategoryDto[];
  defaultCategoryId?: number;
  onClose: () => void;
  onSave: (form: FormState) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function ItemModal({
  editing,
  categories,
  defaultCategoryId,
  onClose,
  onSave,
  saving,
  saveError,
}: ItemModalProps) {
  const init = editing
    ? defaultForm(editing)
    : {
        ...defaultForm(),
        menuCategoryId: defaultCategoryId != null ? String(defaultCategoryId) : "",
      };

  const [form, setForm] = useState<FormState>(init);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const priceNum = parseFloat(form.price);
  const priceValid = form.price !== "" && !isNaN(priceNum) && priceNum >= 0;
  const catValid = form.menuCategoryId !== "";
  const canSubmit = form.name.trim() !== "" && priceValid && catValid;

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
        <h3 className="modal-title">
          {editing ? "Artikel bearbeiten" : "Neuer Artikel"}
        </h3>
        <p className="modal-subtitle">
          {editing
            ? `ID ${editing.id} · Felder leer lassen um bestehende Werte zu behalten.`
            : "Wird der Speisekarte hinzugefügt."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(form);
          }}
        >
          {/* Name */}
          <div className="form-group">
            <label className="form-label" htmlFor="item-name">
              Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="item-name"
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
            <label className="form-label" htmlFor="item-description">
              Beschreibung
            </label>
            <textarea
              id="item-description"
              className="form-input"
              style={{ resize: "vertical", minHeight: 64 }}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={500}
            />
          </div>

          {/* Price + Weight */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="item-price">
                Preis (€) <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="item-price"
                className="form-input"
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                required
                placeholder="0.00"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="item-weight">
                Gewichtung
              </label>
              <input
                id="item-weight"
                className="form-input"
                type="number"
                value={form.weight}
                onChange={(e) => set("weight", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Category */}
          <div className="form-group">
            <label className="form-label" htmlFor="item-category">
              Kategorie <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select
              id="item-category"
              className="form-input"
              value={form.menuCategoryId}
              onChange={(e) => set("menuCategoryId", e.target.value)}
              required
            >
              <option value="">— Bitte wählen —</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Locked */}
          <div className="form-group cat-checkbox-group">
            <label className="form-label" htmlFor="item-locked">
              Status
            </label>
            <label className="cat-checkbox-label" htmlFor="item-locked">
              <input
                id="item-locked"
                type="checkbox"
                checked={form.isLocked}
                onChange={(e) => set("isLocked", e.target.checked)}
              />
              Gesperrt
            </label>
            <span className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Gesperrte Artikel sind für Kellner unsichtbar.
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
  item: MenuItemDto;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  deleting: boolean;
  deleteError: string | null;
}

function DeleteConfirmModal({
  item,
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
        <h3 className="modal-title">Artikel löschen?</h3>
        <p className="modal-subtitle">
          „{item.name}" wird unwiderruflich entfernt.
        </p>

        {deleteError && <div className="cat-delete-error">{deleteError}</div>}

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
// MenuItemsPage
// ---------------------------------------------------------------------------

export function MenuItemsPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [allItems, setAllItems] = useState<MenuItemDto[]>([]);
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  // Set of item IDs that have at least one stock requirement
  const [itemsWithStock, setItemsWithStock] = useState<Set<number>>(new Set());

  // Filters & sort
  const [filterCategoryId, setFilterCategoryId] = useState<number | "all">("all");
  const [sort, setSort] = useState<SortKey>(undefined);

  // Create / edit modal
  const [editTarget, setEditTarget] = useState<MenuItemDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<MenuItemDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [{ items }, { categories: cats }] = await Promise.all([
        api.menu.listItems(),
        api.menu.listCategories(),
      ]);
      setAllItems(items);
      setCategories(cats);
      setState({ status: "ok" });

      // Fetch stock badges in the background — non-blocking
      if (items.length > 0) {
        Promise.all(
          items.map((item) =>
            api.stock.getMenuItemRequirements(item.id).then((r) => ({
              id: item.id,
              hasStock: r.requirements.length > 0,
            }))
          )
        )
          .then((results) => {
            const withStock = new Set(
              results.filter((r) => r.hasStock).map((r) => r.id)
            );
            setItemsWithStock(withStock);
          })
          .catch(() => {
            /* stock badges are best-effort */
          });
      }
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

  // ── Derived: filtered + sorted list ──────────────────────────────────────

  const visibleItems = (() => {
    let list = filterCategoryId === "all"
      ? allItems
      : allItems.filter((i) => i.menuCategoryId === filterCategoryId);

    if (sort === "weight,name") {
      list = [...list].sort(
        (a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "de")
      );
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, "de"));
    }

    return list;
  })();

  // ── Create / Update ──────────────────────────────────────────────────────

  async function handleSave(form: FormState) {
    setSaving(true);
    setSaveError(null);
    try {
      const base = {
        name: form.name.trim(),
        price: parseFloat(form.price),
        menuCategoryId: parseInt(form.menuCategoryId, 10),
        ...(form.description.trim() && { description: form.description.trim() }),
        ...(form.weight !== "" && { weight: parseInt(form.weight, 10) }),
        ...(form.isLocked && { isLocked: true }),
      };

      if (editTarget === "new") {
        const created = await api.menu.createItem(base);
        setAllItems((prev) => [...prev, created]);
      } else if (editTarget) {
        const updated = await api.menu.updateItem(editTarget.id, {
          name: form.name.trim(),
          description: form.description.trim(),
          price: parseFloat(form.price),
          isLocked: form.isLocked,
          menuCategoryId: parseInt(form.menuCategoryId, 10),
          ...(form.weight !== "" && { weight: parseInt(form.weight, 10) }),
        });
        setAllItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
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
      await api.menu.deleteItem(deleteTarget.id);
      setAllItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Fehler beim Löschen.");
    } finally {
      setDeleting(false);
    }
  }

  // ── Lock / Unlock toggle ──────────────────────────────────────────────────

  async function handleToggleLock(item: MenuItemDto) {
    const toggled = { ...item, isLocked: !item.isLocked };
    setAllItems((prev) => prev.map((i) => (i.id === item.id ? toggled : i)));
    try {
      const result = await api.menu.updateItem(item.id, { isLocked: !item.isLocked });
      setAllItems((prev) => prev.map((i) => (i.id === result.id ? result : i)));
    } catch {
      setAllItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function categoryName(id: number): string {
    return categories.find((c) => c.id === id)?.name ?? `#${id}`;
  }

  function openCreate() {
    setSaveError(null);
    setEditTarget("new");
  }

  function openEdit(item: MenuItemDto) {
    setSaveError(null);
    setEditTarget(item);
  }

  function openDelete(item: MenuItemDto) {
    setDeleteError(null);
    setDeleteTarget(item);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Artikel</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Artikel</h1>
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
        <h1 className="page-title">Artikel</h1>
        <button className="btn-primary" style={{ width: "auto" }} onClick={openCreate}>
          + Neuer Artikel
        </button>
      </div>

      {/* Filter + sort toolbar */}
      <div className="items-toolbar">
        <select
          className="form-input items-toolbar__category-select"
          value={filterCategoryId === "all" ? "all" : String(filterCategoryId)}
          onChange={(e) =>
            setFilterCategoryId(
              e.target.value === "all" ? "all" : parseInt(e.target.value, 10)
            )
          }
        >
          <option value="all">Alle Kategorien</option>
          {categories.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="items-toolbar__sort">
          <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            Sortierung:
          </span>
          <button
            className={sort === "weight,name" ? "btn-secondary items-sort-active" : "btn-secondary"}
            onClick={() => setSort("weight,name")}
          >
            Gewichtung
          </button>
          <button
            className={sort === undefined ? "btn-secondary items-sort-active" : "btn-secondary"}
            onClick={() => setSort(undefined)}
          >
            Name
          </button>
        </div>
      </div>

      {/* Empty state */}
      {allItems.length === 0 && (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">Noch keine Artikel vorhanden.</p>
          <button className="btn-secondary" style={{ marginTop: 14 }} onClick={openCreate}>
            Ersten Artikel erstellen
          </button>
        </div>
      )}

      {allItems.length > 0 && visibleItems.length === 0 && (
        <div className="overview-card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <p className="muted">Keine Artikel in dieser Kategorie.</p>
        </div>
      )}

      {/* Items list */}
      {visibleItems.length > 0 && (
        <div className="items-list">
          {/* Header row */}
          <div className="items-row items-row--header">
            <span className="items-col-name">Name</span>
            <span className="items-col-desc">Beschreibung</span>
            <span className="items-col-price">Preis</span>
            <span className="items-col-weight">Gewicht</span>
            <span className="items-col-category">Kategorie</span>
            <span className="items-col-stock">Lager</span>
            <span className="items-col-status">Status</span>
            <span className="items-col-actions" />
          </div>

          {/* Data rows */}
          {visibleItems.map((item) => (
            <div key={item.id} className="items-row">
              <span className="items-col-name items-text-clamp">{item.name}</span>

              <span className="items-col-desc items-text-clamp">
                {item.description || <em className="muted">—</em>}
              </span>

              <span className="items-col-price">{formatPrice(item.price)}</span>

              <span className="items-col-weight">{item.weight}</span>

              <span className="items-col-category items-text-clamp">
                {categoryName(item.menuCategoryId)}
              </span>

              <span className="items-col-stock">
                {itemsWithStock.has(item.id) ? (
                  <span className="badge-stock" title="Hat Lageranforderungen">
                    🧺
                  </span>
                ) : null}
              </span>

              <span className="items-col-status">
                {item.isLocked ? (
                  <span className="badge-locked">Gesperrt</span>
                ) : (
                  <span className="badge-unlocked">Aktiv</span>
                )}
              </span>

              <span className="items-col-actions">
                <button
                  className={`btn-icon${item.isLocked ? " btn-icon--unlock" : ""}`}
                  title={item.isLocked ? "Entsperren" : "Sperren"}
                  onClick={() => handleToggleLock(item)}
                >
                  {item.isLocked ? "🔓" : "🔒"}
                </button>
                <button
                  className="btn-icon"
                  title="Bearbeiten"
                  onClick={() => openEdit(item)}
                >
                  ✏️
                </button>
                <button
                  className="btn-icon btn-icon--danger"
                  title="Löschen"
                  onClick={() => openDelete(item)}
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
        <ItemModal
          editing={editTarget === "new" ? null : editTarget}
          categories={categories}
          defaultCategoryId={
            filterCategoryId !== "all" ? filterCategoryId : undefined
          }
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Delete confirm modal */}
      {deleteTarget != null && (
        <DeleteConfirmModal
          item={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
          deleteError={deleteError}
        />
      )}
    </div>
  );
}
