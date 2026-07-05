import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  OrdersQuery,
  TableDto,
  UserDto,
} from "@bstoema/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface FilterState {
  tableId: string;
  userId: string;
  from: string;
  to: string;
}

const emptyFilters: FilterState = { tableId: "", userId: "", from: "", to: "" };

const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildQuery(f: FilterState): OrdersQuery {
  const q: OrdersQuery = {};
  if (f.tableId) q.tableId = Number(f.tableId);
  if (f.userId) q.userId = Number(f.userId);
  const from = localToIso(f.from);
  const to = localToIso(f.to);
  if (from) q.from = from;
  if (to) q.to = to;
  return q;
}

function hasFilters(f: FilterState): boolean {
  return f.tableId !== "" || f.userId !== "" || f.from !== "" || f.to !== "";
}

// ---------------------------------------------------------------------------
// OrdersPage
// ---------------------------------------------------------------------------

export function OrdersPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [orders, setOrders] = useState<OrderDto[]>([]);

  const [tables, setTables] = useState<TableDto[]>([]);
  const [waiters, setWaiters] = useState<UserDto[]>([]);
  const [menuItems, setMenuItems] = useState<Map<number, MenuItemDto>>(new Map());

  const [filters, setFilters] = useState<FilterState>(emptyFilters);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Map<number, OrderDto>>(new Map());
  const [detailLoading, setDetailLoading] = useState<Set<number>>(new Set());
  const [detailError, setDetailError] = useState<Map<number, string>>(new Map());

  const inFlight = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // ── Load lookup tables once ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tablesRes, usersRes, itemsRes] = await Promise.all([
          api.tables.list(),
          api.users.list(),
          api.menu.listItems(),
        ]);
        if (cancelled) return;
        setTables(tablesRes.tables);
        setWaiters(usersRes.users);
        const map = new Map<number, MenuItemDto>();
        for (const i of itemsRes.items) map.set(i.id, i);
        setMenuItems(map);
      } catch {
        // Lookup labels are non-essential — ids will fall back to "#N".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // ── Load orders ──────────────────────────────────────────────────────────
  const load = useCallback(
    async (showLoading: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (showLoading) setState({ status: "loading" });
      try {
        const { orders: list } = await api.orders.list(buildQuery(filtersRef.current));
        setOrders(list);
        setState({ status: "ok" });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Fehler beim Laden.",
        });
      } finally {
        inFlight.current = false;
      }
    },
    [api],
  );

  // Re-fetch on filter change (debounced).
  useEffect(() => {
    const id = setTimeout(() => load(true), 200);
    return () => clearTimeout(id);
  }, [filters, load]);

  // 5s background poll.
  useEffect(() => {
    const id = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // ── Lookups ──────────────────────────────────────────────────────────────
  const tableName = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of tables) m.set(t.id, t.name);
    return m;
  }, [tables]);

  const waiterName = useMemo(() => {
    const m = new Map<number, string>();
    for (const w of waiters) m.set(w.id, w.username);
    return m;
  }, [waiters]);

  // ── Expand / details ─────────────────────────────────────────────────────
  async function handleExpand(orderId: number) {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(orderId);
    if (details.has(orderId) || detailLoading.has(orderId)) return;

    setDetailLoading((prev) => {
      const next = new Set(prev);
      next.add(orderId);
      return next;
    });
    setDetailError((prev) => {
      if (!prev.has(orderId)) return prev;
      const next = new Map(prev);
      next.delete(orderId);
      return next;
    });

    try {
      const order = await api.orders.getById(orderId);
      setDetails((prev) => new Map(prev).set(orderId, order));
    } catch (err) {
      setDetailError((prev) =>
        new Map(prev).set(
          orderId,
          err instanceof Error ? err.message : "Fehler beim Laden der Details.",
        ),
      );
    } finally {
      setDetailLoading((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  }

  function setFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const header = (
    <div className="page-header">
      <h1 className="page-title">Bestellungen</h1>
      <span className="muted">Aktualisiert alle 5 Sekunden</span>
    </div>
  );

  const toolbar = (
    <div className="orders-toolbar">
      <div className="orders-filter">
        <label className="orders-filter__label" htmlFor="orders-filter-table">
          Tisch
        </label>
        <select
          id="orders-filter-table"
          className="form-input orders-filter__select"
          value={filters.tableId}
          onChange={(e) => setFilter("tableId", e.target.value)}
        >
          <option value="">Alle</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="orders-filter">
        <label className="orders-filter__label" htmlFor="orders-filter-user">
          Kellner
        </label>
        <select
          id="orders-filter-user"
          className="form-input orders-filter__select"
          value={filters.userId}
          onChange={(e) => setFilter("userId", e.target.value)}
        >
          <option value="">Alle</option>
          {waiters.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
      </div>

      <div className="orders-filter">
        <label className="orders-filter__label" htmlFor="orders-filter-from">
          Von
        </label>
        <input
          id="orders-filter-from"
          className="form-input orders-filter__date"
          type="datetime-local"
          value={filters.from}
          onChange={(e) => setFilter("from", e.target.value)}
          max={filters.to || undefined}
        />
      </div>

      <div className="orders-filter">
        <label className="orders-filter__label" htmlFor="orders-filter-to">
          Bis
        </label>
        <input
          id="orders-filter-to"
          className="form-input orders-filter__date"
          type="datetime-local"
          value={filters.to}
          onChange={(e) => setFilter("to", e.target.value)}
          min={filters.from || undefined}
        />
      </div>

      <button
        type="button"
        className="btn-secondary"
        onClick={() => setFilters(emptyFilters)}
        disabled={!hasFilters(filters)}
      >
        Filter zurücksetzen
      </button>
    </div>
  );

  if (state.status === "loading" && orders.length === 0) {
    return (
      <div>
        {header}
        {toolbar}
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        {header}
        {toolbar}
        <p className="form-error">{state.message}</p>
        <button
          className="btn-secondary"
          style={{ marginTop: 12 }}
          onClick={() => load(true)}
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div>
      {header}
      {toolbar}

      {orders.length === 0 ? (
        <div className="overview-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="muted">
            {hasFilters(filters)
              ? "Keine Bestellungen entsprechen dem Filter."
              : "Noch keine Bestellungen."}
          </p>
        </div>
      ) : (
        <div className="orders-list">
          <div className="orders-row orders-row--header">
            <span className="orders-col-time">Zeit</span>
            <span className="orders-col-table">Tisch</span>
            <span className="orders-col-waiter">Kellner</span>
            <span className="orders-col-count">Artikel</span>
            <span className="orders-col-toggle" />
          </div>

          {orders.map((order) => {
            const isExpanded = expandedId === order.id;
            const detail = details.get(order.id);
            const detailErr = detailError.get(order.id);
            const isLoading = detailLoading.has(order.id);
            const totalQty = order.items.reduce(
              (acc: number, i: OrderItemDto) => acc + i.quantity,
              0,
            );

            return (
              <div key={order.id} className="orders-item">
                <button
                  type="button"
                  className={`orders-row orders-row--clickable${
                    isExpanded ? " orders-row--expanded" : ""
                  }`}
                  onClick={() => handleExpand(order.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="orders-col-time">{formatTimestamp(order.timestamp)}</span>
                  <span className="orders-col-table">
                    {tableName.get(order.tableId) ?? `#${order.tableId}`}
                  </span>
                  <span className="orders-col-waiter">
                    {waiterName.get(order.userId) ?? `#${order.userId}`}
                  </span>
                  <span className="orders-col-count">{totalQty}</span>
                  <span className="orders-col-toggle">{isExpanded ? "▾" : "▸"}</span>
                </button>

                {isExpanded && (
                  <div className="orders-detail">
                    {isLoading && <p className="muted">Details werden geladen…</p>}
                    {detailErr && <p className="form-error">{detailErr}</p>}
                    {detail && (
                      <>
                        <div className="orders-detail__meta">
                          <span>
                            <strong>Bestellung #{detail.id}</strong>
                          </span>
                          <span className="muted">{formatTimestamp(detail.timestamp)}</span>
                        </div>
                        {detail.items.length === 0 ? (
                          <p className="muted">Keine Artikel.</p>
                        ) : (
                          <ul className="orders-detail__items">
                            {detail.items.map((item: OrderItemDto) => {
                              const mi = menuItems.get(item.menuItemId);
                              return (
                                <li key={item.id} className="orders-detail__item">
                                  <span className="orders-detail__qty">{item.quantity}×</span>
                                  <span className="orders-detail__name">
                                    {mi ? mi.name : `Menü-Artikel #${item.menuItemId}`}
                                  </span>
                                  {item.specialRequests && (
                                    <span className="orders-detail__notes">
                                      — {item.specialRequests}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
