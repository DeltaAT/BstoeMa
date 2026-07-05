import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiClient } from "../contexts/ApiClientContext";
import { ApiConflictError } from "@bstoema/api-client";
import { MenuExportSchema } from "@bstoema/shared-types";
import type { MenuCategoryDto, MenuExport, MenuItemDto, PrinterDto } from "@bstoema/shared-types";
import { openTextFile, saveTextFile } from "../lib/menu-file";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

function formatPrice(price: number): string {
  return price.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// ---------------------------------------------------------------------------
// Category form
// ---------------------------------------------------------------------------

interface CatForm {
  name: string;
  description: string;
  isLocked: boolean;
  printerId: string;
  orderDisplayId: string;
}

function defaultCatForm(cat?: MenuCategoryDto): CatForm {
  if (!cat) return { name: "", description: "", isLocked: false, printerId: "", orderDisplayId: "" };
  return {
    name: cat.name,
    description: cat.description,
    isLocked: cat.isLocked,
    printerId: cat.printerId != null ? String(cat.printerId) : "",
    orderDisplayId: cat.orderDisplayId != null ? String(cat.orderDisplayId) : "",
  };
}

// ---------------------------------------------------------------------------
// Item form
// ---------------------------------------------------------------------------

interface ItemForm {
  name: string;
  description: string;
  price: string;
  isLocked: boolean;
  menuCategoryId: string;
}

function defaultItemForm(item?: MenuItemDto, defaultCatId?: number): ItemForm {
  if (!item) {
    return {
      name: "",
      description: "",
      price: "",
      isLocked: false,
      menuCategoryId: defaultCatId != null ? String(defaultCatId) : "",
    };
  }
  return {
    name: item.name,
    description: item.description,
    price: String(item.price),
    isLocked: item.isLocked,
    menuCategoryId: String(item.menuCategoryId),
  };
}

// ---------------------------------------------------------------------------
// CategoryModal
// ---------------------------------------------------------------------------

interface CatModalProps {
  editing: MenuCategoryDto | null;
  printers: PrinterDto[];
  onClose: () => void;
  onSave: (form: CatForm) => Promise<void>;
  saving: boolean;
  error: string | null;
}

function CategoryModal({ editing, printers, onClose, onSave, saving, error }: CatModalProps) {
  const [form, setForm] = useState<CatForm>(() => defaultCatForm(editing ?? undefined));
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 50); }, []);

  function set<K extends keyof CatForm>(k: K, v: CatForm[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-card" style={{ width: 460 }}>
        <h3 className="modal-title">{editing ? "Kategorie bearbeiten" : "Neue Kategorie"}</h3>
        <p className="modal-subtitle">
          {editing ? `ID ${editing.id} · Nur geänderte Felder senden.` : "Wird der Speisekarte hinzugefügt."}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <div className="form-group">
            <label className="form-label" htmlFor="cat-name">Name <span className="required-star">*</span></label>
            <input id="cat-name" ref={nameRef} className="form-input" type="text"
              value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cat-desc">Beschreibung</label>
            <textarea id="cat-desc" className="form-input" style={{ resize: "vertical", minHeight: 64 }}
              value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={500} />
          </div>
          <div className="form-group cat-checkbox-group">
            <label className="form-label">Status</label>
            <label className="cat-checkbox-label" htmlFor="cat-locked">
              <input id="cat-locked" type="checkbox" checked={form.isLocked}
                onChange={(e) => set("isLocked", e.target.checked)} />
              Gesperrt
            </label>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cat-printer">Drucker</label>
            <select id="cat-printer" className="form-input" value={form.printerId}
              onChange={(e) => set("printerId", e.target.value)}>
              <option value="">— Kein Drucker —</option>
              {printers.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
            <button type="submit" className="btn-primary modal-submit" disabled={saving || !form.name.trim()}>
              {saving ? "Wird gespeichert…" : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryDeleteModal
// ---------------------------------------------------------------------------

function CategoryDeleteModal({
  cat, onClose, onConfirm, deleting, error,
}: {
  cat: MenuCategoryDto;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  deleting: boolean;
  error: string | null;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <h3 className="modal-title">Kategorie löschen?</h3>
        <p className="modal-subtitle">„{cat.name}" wird unwiderruflich entfernt.</p>
        {error && <div className="cat-delete-error">{error}</div>}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={deleting}>Abbrechen</button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Wird gelöscht…" : "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ItemModal
// ---------------------------------------------------------------------------

interface ItemModalProps {
  editing: MenuItemDto | null;
  categories: MenuCategoryDto[];
  defaultCatId?: number;
  onClose: () => void;
  onSave: (form: ItemForm) => Promise<void>;
  saving: boolean;
  error: string | null;
}

function ItemModal({ editing, categories, defaultCatId, onClose, onSave, saving, error }: ItemModalProps) {
  const [form, setForm] = useState<ItemForm>(() => defaultItemForm(editing ?? undefined, defaultCatId));
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 50); }, []);

  function set<K extends keyof ItemForm>(k: K, v: ItemForm[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  const priceNum = parseFloat(form.price);
  const canSubmit = form.name.trim() !== "" && form.price !== "" && !isNaN(priceNum) && priceNum >= 0 && form.menuCategoryId !== "";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ width: 480 }}>
        <h3 className="modal-title">{editing ? "Artikel bearbeiten" : "Neuer Artikel"}</h3>
        <p className="modal-subtitle">
          {editing ? `ID ${editing.id} · Änderungen werden sofort übernommen.` : "Wird der Speisekarte hinzugefügt."}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSave(form); }}>
          <div className="form-group">
            <label className="form-label" htmlFor="item-name">Name <span className="required-star">*</span></label>
            <input id="item-name" ref={nameRef} className="form-input" type="text"
              value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="item-desc">Beschreibung</label>
            <textarea id="item-desc" className="form-input" style={{ resize: "vertical", minHeight: 60 }}
              value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={500} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="item-price">Preis (€) <span className="required-star">*</span></label>
            <input id="item-price" className="form-input" type="number" min={0} step="0.01"
              value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0,00" required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="item-cat">Kategorie <span className="required-star">*</span></label>
            <select id="item-cat" className="form-input" value={form.menuCategoryId}
              onChange={(e) => set("menuCategoryId", e.target.value)} required>
              <option value="">— Bitte wählen —</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group cat-checkbox-group">
            <label className="form-label">Status</label>
            <label className="cat-checkbox-label" htmlFor="item-locked">
              <input id="item-locked" type="checkbox" checked={form.isLocked}
                onChange={(e) => set("isLocked", e.target.checked)} />
              Gesperrt
            </label>
            <span className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Gesperrte Artikel sind für Kellner unsichtbar.
            </span>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
            <button type="submit" className="btn-primary modal-submit" disabled={saving || !canSubmit}>
              {saving ? "Wird gespeichert…" : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ItemDeleteModal
// ---------------------------------------------------------------------------

function ItemDeleteModal({
  item, onClose, onConfirm, deleting, error,
}: {
  item: MenuItemDto;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  deleting: boolean;
  error: string | null;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <h3 className="modal-title">Artikel löschen?</h3>
        <p className="modal-subtitle">„{item.name}" wird unwiderruflich entfernt.</p>
        {error && <div className="cat-delete-error">{error}</div>}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={deleting}>Abbrechen</button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Wird gelöscht…" : "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImportModal
// ---------------------------------------------------------------------------

function ImportModal({
  menu,
  onClose,
  onConfirm,
  importing,
  error,
}: {
  menu: MenuExport;
  onClose: () => void;
  onConfirm: (mode: "merge" | "replace") => Promise<void>;
  importing: boolean;
  error: string | null;
}) {
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const categoryCount = menu.categories.length;
  const itemCount = menu.categories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !importing) onClose(); }}>
      <div className="modal-card" style={{ width: 460 }}>
        <h3 className="modal-title">Speisekarte importieren</h3>
        <p className="modal-subtitle">
          Die Datei enthält <strong>{categoryCount}</strong> {categoryCount === 1 ? "Kategorie" : "Kategorien"} und{" "}
          <strong>{itemCount}</strong> {itemCount === 1 ? "Artikel" : "Artikel"}.
        </p>

        <div className="form-group">
          <label className="form-label">Modus</label>
          <label className="cat-checkbox-label" style={{ alignItems: "flex-start" }}>
            <input type="radio" name="import-mode" checked={mode === "merge"}
              onChange={() => setMode("merge")} disabled={importing} />
            <span>
              <strong>Zusammenführen</strong> — vorhandene Kategorien/Artikel per Name aktualisieren, neue hinzufügen.
            </span>
          </label>
          <label className="cat-checkbox-label" style={{ alignItems: "flex-start", marginTop: 8 }}>
            <input type="radio" name="import-mode" checked={mode === "replace"}
              onChange={() => setMode("replace")} disabled={importing} />
            <span>
              <strong>Ersetzen</strong> — die bestehende Speisekarte zuerst vollständig löschen.
            </span>
          </label>
        </div>

        {mode === "replace" && (
          <p className="form-error" style={{ marginTop: 0 }}>
            Achtung: Alle bestehenden Kategorien und Artikel dieses Events werden gelöscht.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={importing}>Abbrechen</button>
          <button type="button" className="btn-primary modal-submit" onClick={() => onConfirm(mode)} disabled={importing}>
            {importing ? "Wird importiert…" : "Importieren"}
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

  // ── Data ─────────────────────────────────────────────────────────────────
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [allItems, setAllItems] = useState<MenuItemDto[]>([]);
  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [itemsWithStock, setItemsWithStock] = useState<Set<number>>(new Set());

  // ── UI ───────────────────────────────────────────────────────────────────
  const [selectedCatId, setSelectedCatId] = useState<number | "all">("all");
  const [itemSortByWeight, setItemSortByWeight] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reorderingItems, setReorderingItems] = useState(false);

  // Category modals
  const [catEdit, setCatEdit] = useState<MenuCategoryDto | "new" | null>(null);
  const [catSaving, setCatSaving] = useState(false);
  const [catSaveErr, setCatSaveErr] = useState<string | null>(null);
  const [catDelete, setCatDelete] = useState<MenuCategoryDto | null>(null);
  const [catDeleting, setCatDeleting] = useState(false);
  const [catDeleteErr, setCatDeleteErr] = useState<string | null>(null);

  // Item modals
  const [itemEdit, setItemEdit] = useState<MenuItemDto | "new" | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [itemSaveErr, setItemSaveErr] = useState<string | null>(null);
  const [itemDelete, setItemDelete] = useState<MenuItemDto | null>(null);
  const [itemDeleting, setItemDeleting] = useState(false);
  const [itemDeleteErr, setItemDeleteErr] = useState<string | null>(null);

  // Import / export
  const [ioBusy, setIoBusy] = useState(false);
  const [ioMsg, setIoMsg] = useState<string | null>(null);
  const [ioErr, setIoErr] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<MenuExport | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [{ categories: cats }, { items }, { printers: prts }] = await Promise.all([
        api.menu.listCategories({ includeRouting: true }),
        api.menu.listItems(),
        api.printers.list(),
      ]);
      const sorted = [...cats].sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "de"));
      setCategories(sorted);
      setAllItems(items);
      setPrinters(prts);
      setState({ status: "ok" });

      // Stock badges — best-effort, non-blocking
      if (items.length > 0) {
        Promise.all(
          items.map((i) =>
            api.stock.getMenuItemRequirements(i.id).then((r) => ({ id: i.id, has: r.requirements.length > 0 }))
          )
        )
          .then((res) => setItemsWithStock(new Set(res.filter((r) => r.has).map((r) => r.id))))
          .catch(() => {/* silently ignore */});
      }
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Fehler beim Laden." });
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const visibleItems = useMemo(() => {
    const base = selectedCatId === "all"
      ? allItems
      : allItems.filter((i) => i.menuCategoryId === selectedCatId);
    return itemSortByWeight
      ? [...base].sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "de"))
      : [...base].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [allItems, selectedCatId, itemSortByWeight]);

  function itemCount(catId: number) {
    return allItems.filter((i) => i.menuCategoryId === catId).length;
  }

  function categoryName(catId: number) {
    return categories.find((c) => c.id === catId)?.name ?? `#${catId}`;
  }

  function panelTitle() {
    if (selectedCatId === "all") return "Alle Artikel";
    return categories.find((c) => c.id === selectedCatId)?.name ?? "Artikel";
  }

  // ── Category CRUD ─────────────────────────────────────────────────────────

  async function handleCatSave(form: CatForm) {
    setCatSaving(true);
    setCatSaveErr(null);
    try {
      if (catEdit === "new") {
        const body = {
          name: form.name.trim(),
          ...(form.description.trim() && { description: form.description.trim() }),
          ...(form.isLocked && { isLocked: true }),
          ...(form.printerId !== "" && { printerId: parseInt(form.printerId, 10) }),
          ...(form.orderDisplayId !== "" && { orderDisplayId: parseInt(form.orderDisplayId, 10) }),
        };
        const created = await api.menu.createCategory(body);
        setCategories((prev) =>
          [...prev, created].sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "de"))
        );
      } else if (catEdit) {
        const body = {
          name: form.name.trim(),
          description: form.description.trim(),
          isLocked: form.isLocked,
          ...(form.printerId !== "" && { printerId: parseInt(form.printerId, 10) }),
          ...(form.orderDisplayId !== "" && { orderDisplayId: parseInt(form.orderDisplayId, 10) }),
        };
        const updated = await api.menu.updateCategory(catEdit.id, body);
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
      setCatEdit(null);
    } catch (err) {
      setCatSaveErr(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setCatSaving(false);
    }
  }

  async function handleCatDelete() {
    if (!catDelete) return;
    setCatDeleting(true);
    setCatDeleteErr(null);
    try {
      await api.menu.deleteCategory(catDelete.id);
      setCategories((prev) => prev.filter((c) => c.id !== catDelete.id));
      if (selectedCatId === catDelete.id) setSelectedCatId("all");
      setCatDelete(null);
    } catch (err) {
      if (err instanceof ApiConflictError) {
        setCatDeleteErr("Diese Kategorie enthält noch Artikel. Bitte alle Artikel zuerst entfernen.");
      } else {
        setCatDeleteErr(err instanceof Error ? err.message : "Fehler beim Löschen.");
      }
    } finally {
      setCatDeleting(false);
    }
  }

  async function handleCatToggleLock(cat: MenuCategoryDto) {
    const optimistic = { ...cat, isLocked: !cat.isLocked };
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? optimistic : c)));
    try {
      const result = await api.menu.updateCategory(cat.id, { isLocked: !cat.isLocked });
      setCategories((prev) => prev.map((c) => (c.id === result.id ? result : c)));
    } catch {
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
    }
  }

  async function moveCategory(idx: number, direction: -1 | 1) {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= categories.length) return;
    const reordered = [...categories];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const withWeights = reordered.map((c, i) => ({ ...c, weight: (i + 1) * 10 }));
    setCategories(withWeights);
    setReordering(true);
    try {
      await Promise.all([
        api.menu.updateCategory(withWeights[idx].id, { weight: withWeights[idx].weight }),
        api.menu.updateCategory(withWeights[swapIdx].id, { weight: withWeights[swapIdx].weight }),
      ]);
    } catch {
      load();
    } finally {
      setReordering(false);
    }
  }

  // ── Item reorder ─────────────────────────────────────────────────────────

  async function moveItem(idx: number, direction: -1 | 1) {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= visibleItems.length) return;

    // Switch to custom-order view so the move is visible and not re-sorted away by name
    setItemSortByWeight(true);

    // Reassign weights across the whole visible list so they stay consistent
    const reordered = [...visibleItems];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const withWeights = reordered.map((item, i) => ({ ...item, weight: (i + 1) * 10 }));

    // Optimistic update: patch only the affected items inside allItems
    setAllItems((prev) =>
      prev.map((i) => {
        const updated = withWeights.find((w) => w.id === i.id);
        return updated ?? i;
      })
    );

    setReorderingItems(true);
    try {
      await Promise.all([
        api.menu.updateItem(withWeights[idx].id,    { weight: withWeights[idx].weight }),
        api.menu.updateItem(withWeights[swapIdx].id, { weight: withWeights[swapIdx].weight }),
      ]);
    } catch {
      load(); // full reload on failure
    } finally {
      setReorderingItems(false);
    }
  }

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  async function handleItemSave(form: ItemForm) {
    setItemSaving(true);
    setItemSaveErr(null);
    try {
      if (itemEdit === "new") {
        const body = {
          name: form.name.trim(),
          price: parseFloat(form.price),
          menuCategoryId: parseInt(form.menuCategoryId, 10),
          ...(form.description.trim() && { description: form.description.trim() }),
          ...(form.isLocked && { isLocked: true }),
        };
        const created = await api.menu.createItem(body);
        setAllItems((prev) => [...prev, created]);
      } else if (itemEdit) {
        const updated = await api.menu.updateItem(itemEdit.id, {
          name: form.name.trim(),
          description: form.description.trim(),
          price: parseFloat(form.price),
          isLocked: form.isLocked,
          menuCategoryId: parseInt(form.menuCategoryId, 10),
        });
        setAllItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      setItemEdit(null);
    } catch (err) {
      setItemSaveErr(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setItemSaving(false);
    }
  }

  async function handleItemDelete() {
    if (!itemDelete) return;
    setItemDeleting(true);
    setItemDeleteErr(null);
    try {
      await api.menu.deleteItem(itemDelete.id);
      setAllItems((prev) => prev.filter((i) => i.id !== itemDelete.id));
      setItemDelete(null);
    } catch (err) {
      setItemDeleteErr(err instanceof Error ? err.message : "Fehler beim Löschen.");
    } finally {
      setItemDeleting(false);
    }
  }

  async function handleItemToggleLock(item: MenuItemDto) {
    const optimistic = { ...item, isLocked: !item.isLocked };
    setAllItems((prev) => prev.map((i) => (i.id === item.id ? optimistic : i)));
    try {
      const result = await api.menu.updateItem(item.id, { isLocked: !item.isLocked });
      setAllItems((prev) => prev.map((i) => (i.id === result.id ? result : i)));
    } catch {
      setAllItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  }

  // ── Import / export ────────────────────────────────────────────────────────

  async function handleExport() {
    setIoBusy(true);
    setIoErr(null);
    setIoMsg(null);
    try {
      const data = await api.menu.exportMenu();
      const saved = await saveTextFile(
        "speisekarte.json",
        JSON.stringify(data, null, 2),
        "json",
      );
      if (saved) {
        const items = data.categories.reduce((s, c) => s + c.items.length, 0);
        setIoMsg(`Exportiert: ${data.categories.length} Kategorien, ${items} Artikel.`);
      }
    } catch (err) {
      setIoErr(err instanceof Error ? err.message : "Export fehlgeschlagen.");
    } finally {
      setIoBusy(false);
    }
  }

  async function handleImportPick() {
    setIoBusy(true);
    setIoErr(null);
    setIoMsg(null);
    try {
      const text = await openTextFile("json");
      if (text == null) return; // cancelled
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setIoErr("Die Datei ist kein gültiges JSON.");
        return;
      }
      const parsed = MenuExportSchema.safeParse(raw);
      if (!parsed.success) {
        setIoErr("Die Datei ist keine gültige Speisekarten-Export-Datei.");
        return;
      }
      setImportErr(null);
      setPendingImport(parsed.data);
    } catch (err) {
      setIoErr(err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.");
    } finally {
      setIoBusy(false);
    }
  }

  async function handleImportConfirm(mode: "merge" | "replace") {
    if (!pendingImport) return;
    setImporting(true);
    setImportErr(null);
    try {
      const res = await api.menu.importMenu({ menu: pendingImport, mode });
      setPendingImport(null);
      setIoMsg(
        `Import abgeschlossen: ${res.categoriesCreated + res.categoriesUpdated} Kategorien, ` +
          `${res.itemsCreated + res.itemsUpdated} Artikel.`,
      );
      await load();
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : "Import fehlgeschlagen.");
    } finally {
      setImporting(false);
    }
  }

  // ── Loading / Error ───────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="page-header" style={{ marginBottom: ioMsg || ioErr ? 8 : 16 }}>
        <h1 className="page-title">Speisekarte</h1>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {reordering && (
            <span className="muted" style={{ fontSize: 12 }}>Reihenfolge wird gespeichert…</span>
          )}
          <button
            className="btn-secondary"
            style={{ width: "auto", padding: "7px 14px", fontSize: 13 }}
            onClick={handleExport}
            disabled={ioBusy}
            title="Speisekarte als Datei exportieren"
          >
            ⭳ Exportieren
          </button>
          <button
            className="btn-secondary"
            style={{ width: "auto", padding: "7px 14px", fontSize: 13 }}
            onClick={handleImportPick}
            disabled={ioBusy}
            title="Speisekarte aus einer Datei importieren"
          >
            ⭱ Importieren
          </button>
        </div>
      </div>

      {(ioMsg || ioErr) && (
        <p
          className={ioErr ? "form-error" : "muted"}
          style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}
          role={ioErr ? "alert" : undefined}
        >
          {ioErr ?? ioMsg}
        </p>
      )}

      {/* ── Two-panel layout ─────────────────────────────────────────── */}
      <div className="menu-layout">

        {/* ── LEFT: categories ──────────────────────────────────────── */}
        <div className="menu-cats-panel">
          {/* Panel header */}
          <div className="menu-panel-header">
            <span className="menu-panel-header__title">Kategorien</span>
            <button
              className="menu-panel-header__add"
              onClick={() => { setCatSaveErr(null); setCatEdit("new"); }}
              title="Neue Kategorie"
            >
              +
            </button>
          </div>

          {/* "All" row */}
          <button
            className={`menu-cat-all${selectedCatId === "all" ? " menu-cat-all--active" : ""}`}
            onClick={() => setSelectedCatId("all")}
          >
            <span className="menu-cat-all__label">Alle Artikel</span>
            <span className="menu-cat-count">{allItems.length}</span>
          </button>

          {/* Divider */}
          <div className="menu-cats-divider" />

          {/* Category list */}
          <div className="menu-cats-scroll">
            {categories.length === 0 ? (
              <div className="menu-cats-empty">
                <p className="muted" style={{ fontSize: 12, textAlign: "center", padding: "24px 16px" }}>
                  Noch keine Kategorien.
                </p>
              </div>
            ) : (
              categories.map((cat, idx) => (
                <div
                  key={cat.id}
                  className={`menu-cat-card${selectedCatId === cat.id ? " menu-cat-card--active" : ""}${cat.isLocked ? " menu-cat-card--locked" : ""}`}
                  onClick={() => setSelectedCatId(cat.id)}
                >
                  {/* Reorder buttons */}
                  <div className="menu-cat-card__reorder" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="menu-reorder-btn"
                      disabled={idx === 0 || reordering}
                      onClick={() => moveCategory(idx, -1)}
                      title="Nach oben"
                    >▲</button>
                    <button
                      className="menu-reorder-btn"
                      disabled={idx === categories.length - 1 || reordering}
                      onClick={() => moveCategory(idx, 1)}
                      title="Nach unten"
                    >▼</button>
                  </div>

                  {/* Info */}
                  <div className="menu-cat-card__body">
                    <div className="menu-cat-card__name">{cat.name}</div>
                    {cat.description && (
                      <div className="menu-cat-card__desc">{cat.description}</div>
                    )}
                    <div className="menu-cat-card__meta">
                      <span className="menu-cat-count">{itemCount(cat.id)}</span>
                      {cat.isLocked && <span className="badge-locked" style={{ fontSize: 10, padding: "1px 6px" }}>Gesperrt</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="menu-cat-card__actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`btn-icon${cat.isLocked ? " btn-icon--unlock" : ""}`}
                      style={{ width: 26, height: 26, fontSize: 12 }}
                      title={cat.isLocked ? "Entsperren" : "Sperren"}
                      onClick={() => handleCatToggleLock(cat)}
                    >
                      {cat.isLocked ? "🔓" : "🔒"}
                    </button>
                    <button
                      className="btn-icon"
                      style={{ width: 26, height: 26, fontSize: 12 }}
                      title="Bearbeiten"
                      onClick={() => { setCatSaveErr(null); setCatEdit(cat); }}
                    >✏️</button>
                    <button
                      className="btn-icon btn-icon--danger"
                      style={{ width: 26, height: 26, fontSize: 12 }}
                      title="Löschen"
                      onClick={() => { setCatDeleteErr(null); setCatDelete(cat); }}
                    >🗑️</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: items ──────────────────────────────────────────── */}
        <div className="menu-items-panel">
          {/* Panel header */}
          <div className="menu-panel-header menu-panel-header--items">
            <div className="menu-panel-header__left">
              <span className="menu-panel-header__title">{panelTitle()}</span>
              {selectedCatId !== "all" && (
                <span className="menu-items-panel__count">{visibleItems.length} Artikel</span>
              )}
              {reorderingItems && (
                <span className="muted" style={{ fontSize: 11 }}>Reihenfolge wird gespeichert…</span>
              )}
            </div>
            <div className="menu-panel-header__right">
              {/* Sort toggle */}
              <div className="menu-sort-toggle">
                <button
                  className={`menu-sort-btn${!itemSortByWeight ? " menu-sort-btn--active" : ""}`}
                  onClick={() => setItemSortByWeight(false)}
                >Name</button>
                <button
                  className={`menu-sort-btn${itemSortByWeight ? " menu-sort-btn--active" : ""}`}
                  onClick={() => setItemSortByWeight(true)}
                >Reihenfolge</button>
              </div>
              <button
                className="btn-primary"
                style={{ width: "auto", padding: "7px 14px", fontSize: 13 }}
                onClick={() => {
                  setItemSaveErr(null);
                  setItemEdit("new");
                }}
              >
                + Neuer Artikel
              </button>
            </div>
          </div>

          {/* Items body */}
          <div className="menu-items-scroll">
            {/* Empty state — no categories yet */}
            {categories.length === 0 && (
              <div className="menu-items-empty">
                <div className="menu-items-empty__icon">🍽️</div>
                <p className="menu-items-empty__text">Erstelle zuerst eine Kategorie, um Artikel hinzuzufügen.</p>
                <button
                  className="btn-secondary"
                  onClick={() => { setCatSaveErr(null); setCatEdit("new"); }}
                >
                  Erste Kategorie erstellen
                </button>
              </div>
            )}

            {/* Empty state — category has no items */}
            {categories.length > 0 && visibleItems.length === 0 && (
              <div className="menu-items-empty">
                <div className="menu-items-empty__icon">📋</div>
                <p className="menu-items-empty__text">
                  {selectedCatId === "all"
                    ? "Noch keine Artikel vorhanden."
                    : "Diese Kategorie hat noch keine Artikel."}
                </p>
                <button
                  className="btn-secondary"
                  onClick={() => { setItemSaveErr(null); setItemEdit("new"); }}
                >
                  Ersten Artikel hinzufügen
                </button>
              </div>
            )}

            {/* Items list */}
            {visibleItems.length > 0 && (
              <div className="menu-item-list">
                {visibleItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`menu-item-row${item.isLocked ? " menu-item-row--locked" : ""}`}
                  >
                    {/* Reorder buttons — available within a single category */}
                    {selectedCatId !== "all" && (
                      <div className="menu-item-row__reorder">
                        <button
                          className="menu-reorder-btn"
                          disabled={idx === 0 || reorderingItems}
                          onClick={() => moveItem(idx, -1)}
                          title="Nach oben"
                        >▲</button>
                        <button
                          className="menu-reorder-btn"
                          disabled={idx === visibleItems.length - 1 || reorderingItems}
                          onClick={() => moveItem(idx, 1)}
                          title="Nach unten"
                        >▼</button>
                      </div>
                    )}

                    {/* Main info */}
                    <div className="menu-item-row__info">
                      <div className="menu-item-row__name">
                        {item.name}
                        {itemsWithStock.has(item.id) && (
                          <span className="menu-item-stock-badge" title="Hat Lageranforderungen">🧺</span>
                        )}
                      </div>
                      {item.description && (
                        <div className="menu-item-row__desc">{item.description}</div>
                      )}
                      {selectedCatId === "all" && (
                        <div className="menu-item-row__meta">
                          <span className="menu-item-cat-pill">{categoryName(item.menuCategoryId)}</span>
                        </div>
                      )}
                    </div>

                    {/* Price + status */}
                    <div className="menu-item-row__right">
                      <span className="menu-item-price">{formatPrice(item.price)}</span>
                      <div className="menu-item-status">
                        {item.isLocked
                          ? <span className="badge-locked">Gesperrt</span>
                          : <span className="badge-unlocked">Aktiv</span>
                        }
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="menu-item-row__actions">
                      <button
                        className={`btn-icon${item.isLocked ? " btn-icon--unlock" : ""}`}
                        title={item.isLocked ? "Entsperren" : "Sperren"}
                        onClick={() => handleItemToggleLock(item)}
                      >
                        {item.isLocked ? "🔓" : "🔒"}
                      </button>
                      <button
                        className="btn-icon"
                        title="Bearbeiten"
                        onClick={() => { setItemSaveErr(null); setItemEdit(item); }}
                      >✏️</button>
                      <button
                        className="btn-icon btn-icon--danger"
                        title="Löschen"
                        onClick={() => { setItemDeleteErr(null); setItemDelete(item); }}
                      >🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {catEdit != null && (
        <CategoryModal
          editing={catEdit === "new" ? null : catEdit}
          printers={printers}
          onClose={() => setCatEdit(null)}
          onSave={handleCatSave}
          saving={catSaving}
          error={catSaveErr}
        />
      )}

      {catDelete != null && (
        <CategoryDeleteModal
          cat={catDelete}
          onClose={() => setCatDelete(null)}
          onConfirm={handleCatDelete}
          deleting={catDeleting}
          error={catDeleteErr}
        />
      )}

      {itemEdit != null && (
        <ItemModal
          editing={itemEdit === "new" ? null : itemEdit}
          categories={categories}
          defaultCatId={selectedCatId !== "all" ? selectedCatId : undefined}
          onClose={() => setItemEdit(null)}
          onSave={handleItemSave}
          saving={itemSaving}
          error={itemSaveErr}
        />
      )}

      {itemDelete != null && (
        <ItemDeleteModal
          item={itemDelete}
          onClose={() => setItemDelete(null)}
          onConfirm={handleItemDelete}
          deleting={itemDeleting}
          error={itemDeleteErr}
        />
      )}

      {pendingImport != null && (
        <ImportModal
          menu={pendingImport}
          onClose={() => setPendingImport(null)}
          onConfirm={handleImportConfirm}
          importing={importing}
          error={importErr}
        />
      )}
    </>
  );
}
