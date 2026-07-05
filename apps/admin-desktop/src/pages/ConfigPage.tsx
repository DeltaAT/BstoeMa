import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfigValues } from "@bstoema/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Well-known keys catalog
//
// Each entry annotates a known configuration key with a friendly label,
// description, input type and (optional) placeholder. Unknown keys fall back
// to a plain text editor.
// ---------------------------------------------------------------------------

type KnownKeyType = "string" | "number" | "boolean";

interface KnownKey {
  key: string;
  label: string;
  description?: string;
  type: KnownKeyType;
  placeholder?: string;
  group: string;
  /** Value shown when the key has not been set on the server yet. */
  default?: string;
}

const KNOWN_KEYS: KnownKey[] = [
  {
    key: "event.name",
    label: "Veranstaltungsname",
    description: "Wird auf Bondrucken und im Kellnerportal angezeigt.",
    type: "string",
    placeholder: "z. B. Sommerfest 2026",
    group: "Veranstaltung",
  },
  {
    key: "event.location",
    label: "Ort",
    description: "Optional, z. B. für Druckköpfe.",
    type: "string",
    placeholder: "z. B. Festhalle",
    group: "Veranstaltung",
  },
  {
    key: "currency",
    label: "Währung",
    description: "ISO-Code, z. B. EUR.",
    type: "string",
    placeholder: "EUR",
    group: "Veranstaltung",
  },
  {
    key: "stock.lowThreshold",
    label: "Lager-Niedrigschwelle",
    description: 'Lagerartikel unter dieser Menge werden als „niedrig" markiert.',
    type: "number",
    placeholder: "5",
    group: "Lager",
  },
  {
    key: "stock.lowStockNotify",
    label: "Benachrichtigung bei niedrigem Lager",
    description: "Kellner werden benachrichtigt, wenn ein Lagerartikel zur Neige geht.",
    type: "boolean",
    group: "Lager",
    default: "true",
  },
  {
    key: "order.printTickets",
    label: "Bondrucke aktivieren",
    description: "Bei Bestellung Bons drucken (sofern Drucker zugewiesen).",
    type: "boolean",
    group: "Bestellungen",
    default: "true",
  },
  {
    key: "order.allowSpecialRequests",
    label: "Sonderwünsche erlauben",
    description: "Kellner können freie Notizen pro Position erfassen.",
    type: "boolean",
    group: "Bestellungen",
    default: "true",
  },
  {
    key: "orderDisplays.enabled",
    label: "Bestellanzeigen",
    description: "Bestellanzeigen für Küche/Theke aktivieren.",
    type: "boolean",
    group: "Bestellungen",
    default: "false",
  },
];

const OTHER_GROUP = "Sonstige";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

type RowSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "ok" }
  | { status: "error"; message: string };

function isValidValue(type: KnownKeyType, raw: string): boolean {
  if (type === "string") return true;
  if (type === "number") {
    if (raw.trim() === "") return false;
    const n = Number(raw);
    return !isNaN(n) && isFinite(n);
  }
  if (type === "boolean") return raw === "true" || raw === "false";
  return true;
}

// ---------------------------------------------------------------------------
// AddKeyModal
// ---------------------------------------------------------------------------

interface AddKeyModalProps {
  existingKeys: Set<string>;
  onClose: () => void;
  onSave: (key: string, value: string) => Promise<void>;
  saving: boolean;
  saveError: string | null;
}

function AddKeyModal({
  existingKeys,
  onClose,
  onSave,
  saving,
  saveError,
}: AddKeyModalProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => keyRef.current?.focus(), 50);
  }, []);

  const trimmedKey = key.trim();
  const isDup = trimmedKey !== "" && existingKeys.has(trimmedKey);
  const canSubmit = trimmedKey !== "" && !isDup;

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
        <h3 className="modal-title">Neue Konfiguration</h3>
        <p className="modal-subtitle">
          Schlüssel und Wert frei vergeben. Für bekannte Schlüssel werden
          spezielle Editoren angezeigt.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSave(trimmedKey, value);
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="config-key">
              Schlüssel <span className="required-star">*</span>
            </label>
            <input
              id="config-key"
              ref={keyRef}
              className="form-input"
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              maxLength={120}
              placeholder="z. B. event.location"
            />
            {isDup && (
              <span className="form-error" style={{ marginTop: 4 }}>
                Diese Konfiguration existiert bereits.
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="config-value">
              Wert
            </label>
            <input
              id="config-value"
              className="form-input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
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
// ConfigRow — single editable key/value with per-row save
// ---------------------------------------------------------------------------

interface ConfigRowProps {
  configKey: string;
  serverValue: string;
  known?: KnownKey;
  onSave: (key: string, value: string) => Promise<void>;
}

function ConfigRow({ configKey, serverValue, known, onSave }: ConfigRowProps) {
  const [draft, setDraft] = useState(serverValue);
  const [save, setSave] = useState<RowSaveState>({ status: "idle" });

  // Sync local draft when the server-side value changes (e.g. reload).
  useEffect(() => {
    setDraft(serverValue);
    setSave({ status: "idle" });
  }, [serverValue]);

  const type: KnownKeyType = known?.type ?? "string";
  const dirty = draft !== serverValue;
  const valid = isValidValue(type, draft);
  const canSave = dirty && valid && save.status !== "saving";

  async function handleSave() {
    setSave({ status: "saving" });
    try {
      await onSave(configKey, draft);
      setSave({ status: "ok" });
      setTimeout(() => {
        setSave((cur) => (cur.status === "ok" ? { status: "idle" } : cur));
      }, 1500);
    } catch (err) {
      setSave({
        status: "error",
        message: err instanceof Error ? err.message : "Fehler beim Speichern.",
      });
    }
  }

  return (
    <div className="config-row">
      <div className="config-row__meta">
        <div className="config-row__label">{known?.label ?? configKey}</div>
        <div className="config-row__key">
          <code>{configKey}</code>
        </div>
        {known?.description && (
          <div className="config-row__desc">{known.description}</div>
        )}
      </div>

      <div className="config-row__input">
        {type === "boolean" ? (
          <select
            className="form-input"
            value={draft === "true" ? "true" : "false"}
            onChange={(e) => setDraft(e.target.value)}
          >
            <option value="true">Ein</option>
            <option value="false">Aus</option>
          </select>
        ) : type === "number" ? (
          <input
            className="form-input"
            type="number"
            step="any"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={known?.placeholder}
          />
        ) : (
          <input
            className="form-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={known?.placeholder}
          />
        )}
        {!valid && (
          <span className="form-error" style={{ marginTop: 4 }}>
            Ungültiger Wert.
          </span>
        )}
        {save.status === "error" && (
          <span className="form-error" style={{ marginTop: 4 }}>
            {save.message}
          </span>
        )}
      </div>

      <div className="config-row__actions">
        {save.status === "ok" && (
          <span className="config-saved">✓ Gespeichert</span>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={!dirty || save.status === "saving"}
          onClick={() => setDraft(serverValue)}
        >
          Zurücksetzen
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSave}
          onClick={handleSave}
        >
          {save.status === "saving" ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfigPage
// ---------------------------------------------------------------------------

export function ConfigPage() {
  const api = useApiClient();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [values, setValues] = useState<ConfigValues>({});

  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await api.config.get();
      setValues(res.values);
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

  async function patchOne(key: string, value: string) {
    const res = await api.config.patch({ values: { [key]: value } });
    setValues(res.values);
  }

  async function handleAdd(key: string, value: string) {
    setAddSaving(true);
    setAddError(null);
    try {
      await patchOne(key, value);
      setAddOpen(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setAddSaving(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Einstellungen</h1>
        </div>
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Einstellungen</h1>
        </div>
        <p className="form-error">{state.message}</p>
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>
          Erneut versuchen
        </button>
      </div>
    );
  }

  // Group known keys by their group; render unknown server keys under "Sonstige".
  const existingServerKeys = new Set(Object.keys(values));
  const knownInGroup = new Map<string, KnownKey[]>();
  for (const k of KNOWN_KEYS) {
    const list = knownInGroup.get(k.group) ?? [];
    list.push(k);
    knownInGroup.set(k.group, list);
  }

  const knownKeyNames = new Set(KNOWN_KEYS.map((k) => k.key));
  const unknownServerKeys = Object.keys(values)
    .filter((k) => !knownKeyNames.has(k))
    .sort((a, b) => a.localeCompare(b, "de"));

  // Track which keys are visible (known shown always, unknown shown if present)
  const visibleKeys = new Set<string>();
  for (const k of KNOWN_KEYS) visibleKeys.add(k.key);
  for (const k of unknownServerKeys) visibleKeys.add(k);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Einstellungen</h1>
        <button
          className="btn-primary"
          style={{ width: "auto" }}
          onClick={() => {
            setAddError(null);
            setAddOpen(true);
          }}
        >
          + Neue Konfiguration
        </button>
      </div>

      {/* Known groups */}
      {Array.from(knownInGroup.entries()).map(([group, keys]) => (
        <section key={group} className="config-section">
          <h2 className="config-section__title">{group}</h2>
          <div className="config-list">
            {keys.map((k) => (
              <ConfigRow
                key={k.key}
                configKey={k.key}
                serverValue={values[k.key] ?? k.default ?? ""}
                known={k}
                onSave={patchOne}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Unknown / custom keys */}
      {unknownServerKeys.length > 0 && (
        <section className="config-section">
          <h2 className="config-section__title">{OTHER_GROUP}</h2>
          <div className="config-list">
            {unknownServerKeys.map((k) => (
              <ConfigRow
                key={k}
                configKey={k}
                serverValue={values[k] ?? ""}
                onSave={patchOne}
              />
            ))}
          </div>
        </section>
      )}

      {addOpen && (
        <AddKeyModal
          existingKeys={existingServerKeys}
          onClose={() => setAddOpen(false)}
          onSave={handleAdd}
          saving={addSaving}
          saveError={addError}
        />
      )}
    </div>
  );
}
