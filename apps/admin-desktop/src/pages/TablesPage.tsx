import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { TableDto } from "@bstoema/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";

type QrLayout = "double" | "single";
type QrBrandingMode = "bstoema" | "custom";

const BSTOEMA_WEBSITE_URL = "serva.delta-developing.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface SingleFormState {
  name: string;
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
    return { name: "", isLocked: false };
  }
  return {
    name: table.name,
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

  const canSubmit = form.name.trim() !== "";

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
// QrPreviewModal
// ---------------------------------------------------------------------------

interface QrPreviewModalProps {
  table: TableDto;
  onClose: () => void;
}

function QrPreviewModal({ table, onClose }: QrPreviewModalProps) {
  const api = useApiClient();
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.tables
      .getQrSvg(table.id)
      .then((svg) => {
        setSvgContent(svg);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Fehler beim Laden.");
        setLoading(false);
      });
  }, [api, table.id]);

  async function handleDownloadPdf() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.tables.getTableQrPdf(table.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tisch-${table.name}-qr.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim PDF-Export.");
    } finally {
      setDownloading(false);
    }
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
      <div className="modal-card" style={{ width: 360 }}>
        <h3 className="modal-title">QR-Code – Tisch {table.name}</h3>
        <p className="modal-subtitle">ID {table.id}</p>

        {loading && (
          <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
            Wird geladen…
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        {svgContent && (
          <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
            <img
              src={`data:image/svg+xml,${encodeURIComponent(svgContent)}`}
              alt={`QR-Code Tisch ${table.name}`}
              width={280}
              height={280}
            />
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Schließen
          </button>
          <button
            type="button"
            className="btn-primary modal-submit"
            onClick={handleDownloadPdf}
            disabled={loading || downloading}
          >
            {downloading ? "Wird exportiert…" : "PDF herunterladen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QrExportModal
// ---------------------------------------------------------------------------

/** A small, schematic drawing of the chosen page layout. Mirrors the API:
 *  `double` = A4 portrait, two QR slots split by a cut line; `single` =
 *  A4 landscape, one centred QR (see the #126 single-page orientation fix). */
interface BrandingPreview {
  label?: string;
  logoUrl?: string;
}

function LayoutPreview({
  layout,
  branding,
}: {
  layout: QrLayout;
  branding?: BrandingPreview;
}) {
  const portrait = layout === "double";
  const pageW = portrait ? 150 : 218;
  const pageH = portrait ? 212 : 150;

  const footer = branding && (branding.label || branding.logoUrl) && (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        marginTop: 3,
      }}
    >
      {branding.logoUrl && (
        <img
          src={branding.logoUrl}
          alt=""
          style={{ height: 14, width: "auto", objectFit: "contain" }}
        />
      )}
      {branding.label && (
        <span style={{ fontSize: 7, color: "#52525b", lineHeight: 1 }}>{branding.label}</span>
      )}
    </div>
  );

  const slot = (size: number) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 3,
          border: "1px solid #1f2937",
          background:
            "repeating-conic-gradient(#1f2937 0% 25%, #ffffff 0% 50%) 50% / 7px 7px",
        }}
      />
      {footer}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div
        aria-hidden="true"
        style={{
          width: pageW,
          height: pageH,
          background: "#ffffff",
          border: "1px solid #d4d4d8",
          borderRadius: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: portrait ? "space-evenly" : "center",
          padding: 8,
          boxSizing: "border-box",
        }}
      >
        {portrait ? (
          <>
            {slot(56)}
            <div style={{ width: "100%", borderTop: "1px dashed #a3a3a3" }} />
            {slot(56)}
          </>
        ) : (
          slot(86)
        )}
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        {portrait ? "A4 Hochformat · 2 pro Seite" : "A4 Querformat · 1 pro Seite"}
      </span>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Formats a remaining-seconds estimate as a short German label, e.g.
 *  `8 Sek.` or `1:05 Min.`. */
function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} Sek.`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")} Min.`;
}

interface QrExportModalProps {
  tables: TableDto[];
  onClose: () => void;
}

function QrExportModal({ tables, onClose }: QrExportModalProps) {
  const api = useApiClient();
  const [layout, setLayout] = useState<QrLayout>("double");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(tables.map((t) => t.id)),
  );
  const [brandingEnabled, setBrandingEnabled] = useState(false);
  const [brandingMode, setBrandingMode] = useState<QrBrandingMode>("bstoema");
  const [customLabel, setCustomLabel] = useState("");
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [savePath, setSavePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Live export progress while the PDF is generated server-side. `phase`
  // distinguishes the render phase (per-table progress) from the final save.
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    etaSeconds: number | null;
    phase: "rendering" | "saving";
  } | null>(null);
  const exportStartRef = useRef(0);

  const branding = brandingEnabled
    ? brandingMode === "bstoema"
      ? { mode: "bstoema" as const }
      : {
          mode: "custom" as const,
          ...(customLabel.trim() ? { customLabel: customLabel.trim() } : {}),
          ...(customLogo ? { customLogo } : {}),
        }
    : undefined;

  async function handleLogoFile(file: File | undefined) {
    setDone(false);
    setLogoError(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      setLogoError("Nur PNG- oder JPEG-Bilder werden unterstützt.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setLogoError("Logo darf höchstens 4 MB groß sein.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setCustomLogo(dataUrl);
  }

  const inTauri = isTauri();
  const selectedCount = selectedIds.size;
  const allSelected = tables.length > 0 && selectedCount === tables.length;
  const exportPct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  function toggleTable(id: number) {
    setDone(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setDone(false);
    setSelectedIds(allSelected ? new Set() : new Set(tables.map((t) => t.id)));
  }

  async function pickPath() {
    setError(null);
    setDone(false);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "tables-qr.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (path) setSavePath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speicherort konnte nicht gewählt werden.");
    }
  }

  async function handleExport() {
    setBusy(true);
    setError(null);
    setDone(false);
    exportStartRef.current = Date.now();
    setProgress({ done: 0, total: selectedIds.size, etaSeconds: null, phase: "rendering" });
    try {
      const blob = await api.tables.getQrPdfWithProgress(
        {
          layout,
          tableIds: [...selectedIds],
          ...(branding ? { branding } : {}),
        },
        (renderedDone, total) => {
          const elapsed = Date.now() - exportStartRef.current;
          const etaSeconds =
            renderedDone > 0 && renderedDone < total
              ? Math.max(1, Math.round((elapsed / renderedDone) * (total - renderedDone) / 1000))
              : renderedDone >= total
                ? 0
                : null;
          setProgress({ done: renderedDone, total, etaSeconds, phase: "rendering" });
        },
      );
      // Rendering is finished; the remaining work is writing the file to disk.
      setProgress((prev) =>
        prev ? { ...prev, done: prev.total, etaSeconds: 0, phase: "saving" } : prev,
      );

      if (inTauri) {
        let path = savePath;
        if (!path) {
          const { save } = await import("@tauri-apps/plugin-dialog");
          path = await save({
            defaultPath: "tables-qr.pdf",
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (!path) return; // user cancelled the dialog
          setSavePath(path);
        }
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      } else {
        // Browser fallback (e.g. `vite dev` outside Tauri): anchor download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "tables-qr.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim PDF-Export.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
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
      <div className="modal-card" style={{ width: 620 }}>
        <h3 className="modal-title">QR-Codes exportieren</h3>
        <p className="modal-subtitle">
          {selectedCount} von {tables.length}{" "}
          {tables.length === 1 ? "Tisch" : "Tischen"} ausgewählt · als druckfertige PDF.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
          <div>
            <div className="form-group">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <label className="form-label">Tische auswählen</label>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ width: "auto", padding: "2px 10px", fontSize: 13 }}
                  onClick={toggleAll}
                  disabled={busy || tables.length === 0}
                >
                  {allSelected ? "Keine" : "Alle"}
                </button>
              </div>
              <div
                style={{
                  maxHeight: 180,
                  overflowY: "auto",
                  border: "1px solid #d4d4d8",
                  borderRadius: 6,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {tables.length === 0 ? (
                  <span className="muted" style={{ fontSize: 13 }}>
                    Keine Tische vorhanden.
                  </span>
                ) : (
                  tables.map((table) => (
                    <label
                      key={table.id}
                      style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(table.id)}
                        onChange={() => toggleTable(table.id)}
                        disabled={busy}
                      />
                      {table.name}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="qr-layout">
                Layout
              </label>
              <select
                id="qr-layout"
                className="form-input"
                value={layout}
                onChange={(e) => {
                  setLayout(e.target.value as QrLayout);
                  setDone(false);
                }}
                disabled={busy}
              >
                <option value="double">2 pro Seite</option>
                <option value="single">1 pro Seite</option>
              </select>
            </div>

            <div className="form-group">
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={brandingEnabled}
                  onChange={(e) => {
                    setBrandingEnabled(e.target.checked);
                    setDone(false);
                  }}
                  disabled={busy}
                />
                Werbung / Branding hinzufügen
              </label>

              {brandingEnabled && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 16 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                      <input
                        type="radio"
                        name="qr-branding-mode"
                        checked={brandingMode === "bstoema"}
                        onChange={() => {
                          setBrandingMode("bstoema");
                          setDone(false);
                        }}
                        disabled={busy}
                      />
                      BstöMa-Logo &amp; Website
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                      <input
                        type="radio"
                        name="qr-branding-mode"
                        checked={brandingMode === "custom"}
                        onChange={() => {
                          setBrandingMode("custom");
                          setDone(false);
                        }}
                        disabled={busy}
                      />
                      Eigenes Logo
                    </label>
                  </div>

                  {brandingMode === "custom" && (
                    <>
                      <input
                        className="form-input"
                        type="text"
                        value={customLabel}
                        onChange={(e) => {
                          setCustomLabel(e.target.value);
                          setDone(false);
                        }}
                        placeholder="Eigener Text / Label (optional)"
                        maxLength={120}
                        disabled={busy}
                      />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={(e) => void handleLogoFile(e.target.files?.[0])}
                          disabled={busy}
                          style={{ fontSize: 13, flex: 1, minWidth: 0 }}
                        />
                        {customLogo && (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ width: "auto", padding: "2px 10px", fontSize: 13 }}
                            onClick={() => {
                              setCustomLogo(null);
                              setLogoError(null);
                              setDone(false);
                            }}
                            disabled={busy}
                          >
                            Entfernen
                          </button>
                        )}
                      </div>
                      {logoError && <p className="form-error">{logoError}</p>}
                    </>
                  )}
                </div>
              )}
            </div>

            {inTauri && (
              <div className="form-group">
                <label className="form-label">Speicherort</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="form-input"
                    type="text"
                    readOnly
                    value={savePath ? basename(savePath) : ""}
                    placeholder="tables-qr.pdf"
                    title={savePath ?? undefined}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ width: "auto", whiteSpace: "nowrap" }}
                    onClick={pickPath}
                    disabled={busy}
                  >
                    Wählen…
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Vorschau</label>
            <LayoutPreview
              layout={layout}
              branding={
                brandingEnabled
                  ? brandingMode === "bstoema"
                    ? { label: BSTOEMA_WEBSITE_URL, logoUrl: "/icon.png" }
                    : {
                        ...(customLabel.trim() ? { label: customLabel.trim() } : {}),
                        ...(customLogo ? { logoUrl: customLogo } : {}),
                      }
                  : undefined
              }
            />
          </div>
        </div>

        {busy && progress && (
          <div style={{ marginTop: 4 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                marginBottom: 6,
              }}
            >
              <span className="muted">
                {progress.phase === "saving"
                  ? "PDF wird gespeichert…"
                  : `QR-Codes werden erstellt… ${progress.done}/${progress.total}`}
              </span>
              {progress.phase === "rendering" &&
                progress.etaSeconds != null &&
                progress.etaSeconds > 0 && (
                  <span className="muted">noch ca. {formatEta(progress.etaSeconds)}</span>
                )}
            </div>
            <div
              style={{
                height: 8,
                background: "#e4e4e7",
                borderRadius: 999,
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={exportPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                style={{
                  height: "100%",
                  width: `${exportPct}%`,
                  background: "#2563eb",
                  borderRadius: 999,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {done && !error && (
          <p className="muted" style={{ color: "#15803d", fontSize: 13 }}>
            ✓ Export abgeschlossen{savePath ? ` – ${basename(savePath)}` : ""}.
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Schließen
          </button>
          <button
            type="button"
            className="btn-primary modal-submit"
            onClick={handleExport}
            disabled={busy || selectedCount === 0}
          >
            {busy ? (progress ? `Exportiert… ${exportPct}%` : "Exportiert…") : "Exportieren"}
          </button>
        </div>
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

  // QR export modal
  const [exportOpen, setExportOpen] = useState(false);

  // QR preview
  const [qrPreviewTable, setQrPreviewTable] = useState<TableDto | null>(null);

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
          ...(form.isLocked && { isLocked: true }),
        });
        setTables((prev) => sortTables([...prev, created]));
      } else if (editTarget) {
        const updated = await api.tables.update(editTarget.id, {
          name: form.name.trim(),
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn-secondary"
            style={{ width: "auto" }}
            disabled={tables.length === 0}
            onClick={() => setExportOpen(true)}
          >
            QR exportieren
          </button>
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
              <span className="tables-col-status">
                {table.isLocked ? (
                  <span className="badge-locked">Gesperrt</span>
                ) : (
                  <span className="badge-unlocked">Aktiv</span>
                )}
              </span>
              <span className="tables-col-actions">
                <button
                  className="btn-icon"
                  title="QR-Code anzeigen"
                  style={{ fontSize: 10, fontWeight: 700 }}
                  onClick={() => setQrPreviewTable(table)}
                >
                  QR
                </button>
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

      {qrPreviewTable != null && (
        <QrPreviewModal
          table={qrPreviewTable}
          onClose={() => setQrPreviewTable(null)}
        />
      )}

      {exportOpen && (
        <QrExportModal
          tables={tables}
          onClose={() => setExportOpen(false)}
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
