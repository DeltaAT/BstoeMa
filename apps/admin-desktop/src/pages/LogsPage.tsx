import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogEntryDto, LogLevel } from "@serva/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";

// Display labels mirror the German UI copy in the rest of the admin app.
const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warnung",
  error: "Fehler",
  fatal: "Fatal",
};

const LEVEL_OPTIONS: ReadonlyArray<{ value: LogLevel; label: string }> = [
  { value: "trace", label: "Alle" },
  { value: "debug", label: "Debug+" },
  { value: "info", label: "Info+" },
  { value: "warn", label: "Warnung+" },
  { value: "error", label: "Fehler+" },
];

const POLL_INTERVAL_MS = 2000;
const MAX_ENTRIES = 1000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatContext(ctx: Record<string, unknown> | undefined): string {
  if (!ctx) return "";
  try {
    return JSON.stringify(ctx);
  } catch {
    return "";
  }
}

export function LogsPage() {
  const api = useApiClient();
  const [entries, setEntries] = useState<LogEntryDto[]>([]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [minLevel, setMinLevel] = useState<LogLevel>("info");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");

  // We tear down/recreate the poll timer whenever the level filter or
  // auto-refresh toggle flips, so a stale interval can't keep running.
  const lastIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchOnce = useCallback(
    async (mode: "refresh" | "poll") => {
      try {
        if (mode === "refresh") {
          setState({ status: "loading" });
        }
        const res = await api.logs.list(
          mode === "poll"
            ? { since: lastIdRef.current, minLevel }
            : { minLevel, limit: MAX_ENTRIES },
        );
        if (mode === "refresh") {
          setEntries(res.entries);
          lastIdRef.current = res.lastId;
        } else if (res.entries.length > 0) {
          setEntries((prev) => {
            const merged = [...prev, ...res.entries];
            return merged.length > MAX_ENTRIES
              ? merged.slice(merged.length - MAX_ENTRIES)
              : merged;
          });
          lastIdRef.current = res.lastId;
        }
        setState({ status: "ok" });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Fehler beim Laden.",
        });
      }
    },
    [api, minLevel],
  );

  // Initial load and reload on level change.
  useEffect(() => {
    void fetchOnce("refresh");
  }, [fetchOnce]);

  // Poll loop.
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void fetchOnce("poll");
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchOnce]);

  // Stick the viewport to the latest entry whenever new lines arrive — but
  // only if the user is already near the bottom, so a scrolled-up reader
  // isn't yanked back down mid-read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const needle = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.msg.toLowerCase().includes(needle)) return true;
      if (e.context && formatContext(e.context).toLowerCase().includes(needle)) {
        return true;
      }
      return false;
    });
  }, [entries, search]);

  return (
    <div className="logs-page">
      <div className="page-header">
        <h1 className="page-title">Logs</h1>
        <div className="logs-toolbar">
          <input
            className="form-input logs-search"
            type="search"
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="form-input logs-level-select"
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value as LogLevel)}
          >
            {LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <label className="logs-auto">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-Refresh
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void fetchOnce("refresh")}
          >
            Aktualisieren
          </button>
        </div>
      </div>

      {state.status === "error" && (
        <p className="form-error">{state.message}</p>
      )}

      <div className="logs-viewport" ref={scrollRef}>
        {filtered.length === 0 ? (
          <div className="logs-empty">
            {state.status === "loading" ? "Wird geladen…" : "Keine Eintraege."}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className={`log-row log-row--${entry.level}`}
            >
              <span className="log-time">{formatTime(entry.time)}</span>
              <span className="log-level">{LEVEL_LABEL[entry.level]}</span>
              <span className="log-msg">{entry.msg || "—"}</span>
              {entry.context && (
                <span className="log-context">{formatContext(entry.context)}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
