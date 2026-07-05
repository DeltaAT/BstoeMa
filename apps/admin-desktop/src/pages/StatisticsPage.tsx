import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MenuItemDto, OrderDto, UserDto } from "@bstoema/shared-types";
import { useApiClient } from "../contexts/ApiClientContext";
import { saveTextFile } from "../lib/menu-file";
import { buildOrdersCsv } from "../lib/orders-csv";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5000;

const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const int = new Intl.NumberFormat("de-DE");

const clockFmt = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const hhmmFmt = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

// Candidate bucket sizes (ms) for the time chart, smallest first.
const MIN_5 = 5 * 60_000;
const MIN_15 = 15 * 60_000;
const MIN_30 = 30 * 60_000;
const HOUR = 60 * 60_000;
const BUCKET_SIZES_MS = [
  MIN_5,
  MIN_15,
  MIN_30,
  HOUR,
  2 * HOUR,
  4 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];
// Auto mode targets a readable number of buckets; a manual interval is allowed
// far more bars (so a fine grain over a long span still renders) but is still
// capped for safety and anchored to the most recent window when it overflows.
const MAX_BUCKETS = 16;
const MAX_MANUAL_BUCKETS = 120;

// Interval choices offered in the time-chart selector. "auto" keeps the
// heuristic; the rest pin an explicit bucket size so the operator can zoom the
// distribution in or out (issue #134).
type BucketChoice = "auto" | number;
const INTERVAL_OPTIONS: { label: string; value: BucketChoice }[] = [
  { label: "Auto", value: "auto" },
  { label: "5 Min", value: MIN_5 },
  { label: "15 Min", value: MIN_15 },
  { label: "30 Min", value: MIN_30 },
  { label: "1 Std", value: HOUR },
  { label: "2 Std", value: 2 * HOUR },
  { label: "4 Std", value: 4 * HOUR },
  { label: "6 Std", value: 6 * HOUR },
  { label: "12 Std", value: 12 * HOUR },
  { label: "24 Std", value: 24 * HOUR },
];

interface TimeBucket {
  start: number;
  count: number;
  revenue: number;
}

interface RankedRow {
  key: number;
  label: string;
  primary: number; // revenue (drives bar width)
  secondary: number; // qty or order count
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Stats {
  revenue: number;
  orderCount: number;
  itemCount: number;
  avgOrderValue: number;
  activeWaiters: number;
  topItems: RankedRow[];
  byWaiter: RankedRow[];
}

function computeStats(
  orders: OrderDto[],
  prices: Map<number, MenuItemDto>,
  waiterName: Map<number, string>,
): Stats {
  let revenue = 0;
  let itemCount = 0;
  const waiterIds = new Set<number>();

  const itemAgg = new Map<number, { qty: number; revenue: number }>();
  const waiterAgg = new Map<number, { orders: number; revenue: number }>();

  for (const order of orders) {
    waiterIds.add(order.userId);
    let orderRevenue = 0;
    for (const item of order.items) {
      const price = prices.get(item.menuItemId)?.price ?? 0;
      const line = price * item.quantity;
      revenue += line;
      orderRevenue += line;
      itemCount += item.quantity;

      const ia = itemAgg.get(item.menuItemId) ?? { qty: 0, revenue: 0 };
      ia.qty += item.quantity;
      ia.revenue += line;
      itemAgg.set(item.menuItemId, ia);
    }
    const wa = waiterAgg.get(order.userId) ?? { orders: 0, revenue: 0 };
    wa.orders += 1;
    wa.revenue += orderRevenue;
    waiterAgg.set(order.userId, wa);
  }

  const orderCount = orders.length;

  // Top items by revenue (top 6).
  const topItems: RankedRow[] = [...itemAgg.entries()]
    .map(([id, v]) => ({
      key: id,
      label: prices.get(id)?.name ?? `#${id}`,
      primary: v.revenue,
      secondary: v.qty,
    }))
    .sort((a, b) => b.primary - a.primary)
    .slice(0, 6);

  // Revenue per waiter (top 6).
  const byWaiter: RankedRow[] = [...waiterAgg.entries()]
    .map(([id, v]) => ({
      key: id,
      label: waiterName.get(id) ?? `#${id}`,
      primary: v.revenue,
      secondary: v.orders,
    }))
    .sort((a, b) => b.primary - a.primary)
    .slice(0, 6);

  return {
    revenue,
    orderCount,
    itemCount,
    avgOrderValue: orderCount > 0 ? revenue / orderCount : 0,
    activeWaiters: waiterIds.size,
    topItems,
    byWaiter,
  };
}

// Buckets the orders over time. With `choice === "auto"` the bucket size is
// picked so the whole span fits in ~MAX_BUCKETS bars; otherwise the given size
// (ms) is used verbatim so the operator can pin the resolution. A manual grain
// that would overflow the safety cap is anchored to the most recent window so
// current activity always stays on screen.
function buildTimeBuckets(
  orders: OrderDto[],
  prices: Map<number, MenuItemDto>,
  choice: BucketChoice,
): TimeBucket[] {
  if (orders.length === 0) return [];

  const times = orders.map((o) => new Date(o.timestamp).getTime());
  const min = Math.min(...times);
  const now = Date.now();
  const span = Math.max(now - min, 60_000);

  let size: number;
  let start: number;
  let count: number;

  if (choice === "auto") {
    size = BUCKET_SIZES_MS[BUCKET_SIZES_MS.length - 1];
    for (const candidate of BUCKET_SIZES_MS) {
      if (Math.ceil(span / candidate) <= MAX_BUCKETS) {
        size = candidate;
        break;
      }
    }
    start = Math.floor(min / size) * size;
    count = Math.min(MAX_BUCKETS, Math.ceil((now - start) / size) + 1);
  } else {
    size = choice;
    start = Math.floor(min / size) * size;
    count = Math.ceil((now - start) / size) + 1;
    if (count > MAX_MANUAL_BUCKETS) {
      count = MAX_MANUAL_BUCKETS;
      // Slide the window so its last bucket covers "now".
      start = Math.floor(now / size) * size - (count - 1) * size;
    }
  }

  const buckets: TimeBucket[] = [];
  for (let i = 0; i < count; i += 1) {
    buckets.push({ start: start + i * size, count: 0, revenue: 0 });
  }

  for (const order of orders) {
    const t = new Date(order.timestamp).getTime();
    const idx = Math.floor((t - start) / size);
    if (idx < 0 || idx >= buckets.length) continue;
    const bucket = buckets[idx];
    bucket.count += 1;
    for (const item of order.items) {
      bucket.revenue += (prices.get(item.menuItemId)?.price ?? 0) * item.quantity;
    }
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card${accent ? " stat-card--accent" : ""}`}>
      <span className="stat-card__value">{value}</span>
      <span className="stat-card__label">{label}</span>
    </div>
  );
}

function TimeBarChart({ buckets }: { buckets: TimeBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  // Label at most ~6 ticks so the axis doesn't crowd.
  const tickStep = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div className="barchart" role="img" aria-label="Bestellungen im Zeitverlauf">
      <div className="barchart__cols">
        {buckets.map((b, i) => {
          const heightPct = (b.count / max) * 100;
          return (
            <div className="barchart__col" key={b.start}>
              <div className="barchart__bar-wrap">
                <span className="barchart__count">{b.count > 0 ? b.count : ""}</span>
                <div
                  className="barchart__bar"
                  style={{ height: `${heightPct}%` }}
                  title={`${hhmmFmt.format(new Date(b.start))} · ${b.count} Bestellungen · ${eur.format(b.revenue)}`}
                />
              </div>
              <span className="barchart__tick">
                {i % tickStep === 0 ? hhmmFmt.format(new Date(b.start)) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RankedBars({
  rows,
  valueFormat,
  secondaryLabel,
}: {
  rows: RankedRow[];
  valueFormat: (n: number) => string;
  secondaryLabel: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.primary));
  return (
    <ul className="hbar-list">
      {rows.map((r) => (
        <li className="hbar" key={r.key}>
          <div className="hbar__head">
            <span className="hbar__label" title={r.label}>
              {r.label}
            </span>
            <span className="hbar__value">{valueFormat(r.primary)}</span>
          </div>
          <div className="hbar__track">
            <div
              className="hbar__fill"
              style={{ width: `${(r.primary / max) * 100}%` }}
            />
          </div>
          <span className="hbar__secondary">{secondaryLabel(r.secondary)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// StatisticsPage
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

export function StatisticsPage() {
  const api = useApiClient();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [prices, setPrices] = useState<Map<number, MenuItemDto>>(new Map());
  const [waiterName, setWaiterName] = useState<Map<number, string>>(new Map());
  const [tableCount, setTableCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const inFlight = useRef(false);

  const load = useCallback(
    async (showLoading: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (showLoading) setState({ status: "loading" });
      try {
        const [ordersRes, itemsRes, usersRes, tablesRes] = await Promise.all([
          api.orders.list({}),
          api.menu.listItems(),
          api.users.list(),
          api.tables.list(),
        ]);
        setOrders(ordersRes.orders);
        setPrices(new Map(itemsRes.items.map((i: MenuItemDto) => [i.id, i])));
        setWaiterName(
          new Map(usersRes.users.map((u: UserDto) => [u.id, u.username])),
        );
        setTableCount(tablesRes.tables.length);
        setLastUpdated(new Date());
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

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const stats = useMemo(
    () => computeStats(orders, prices, waiterName),
    [orders, prices, waiterName],
  );

  // Time-chart interval: "auto" or a fixed bucket size in ms. Kept out of
  // computeStats so changing it only re-buckets, not re-aggregates everything.
  const [bucketChoice, setBucketChoice] = useState<BucketChoice>("auto");
  const buckets = useMemo(
    () => buildTimeBuckets(orders, prices, bucketChoice),
    [orders, prices, bucketChoice],
  );

  // CSV export (issue #136): fetch the flat order-line dump from the API,
  // serialize it and save via the shared file helper (Tauri dialog or
  // browser download in `vite dev`).
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function handleExportCsv() {
    setExporting(true);
    setExportMsg(null);
    setExportErr(null);
    try {
      const data = await api.orders.exportData();
      const date = new Date().toISOString().slice(0, 10);
      const saved = await saveTextFile(
        `bestellungen-${date}.csv`,
        buildOrdersCsv(data),
        "csv",
      );
      if (saved) {
        setExportMsg(`Exportiert: ${int.format(data.rows.length)} Positionen.`);
      }
    } catch (err) {
      setExportErr(
        err instanceof Error ? err.message : "Export fehlgeschlagen.",
      );
    } finally {
      setExporting(false);
    }
  }

  const header = (
    <div className="page-header">
      <h1 className="page-title">Statistik</h1>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <span className="stats-live">
          <span className="stats-live__dot" aria-hidden="true" />
          Live · alle 5&nbsp;Sekunden
          {lastUpdated && (
            <span className="muted">
              {" "}
              (zuletzt {clockFmt.format(lastUpdated)})
            </span>
          )}
        </span>
        <button
          className="btn-secondary"
          style={{ width: "auto", padding: "7px 14px", fontSize: 13 }}
          onClick={handleExportCsv}
          disabled={exporting || orders.length === 0}
          title="Alle Bestelldaten als CSV-Datei exportieren"
        >
          {exporting ? "Wird exportiert…" : "⭳ CSV exportieren"}
        </button>
      </div>
    </div>
  );

  const exportStatus = (exportMsg || exportErr) && (
    <p
      className={exportErr ? "form-error" : "muted"}
      style={{ margin: "-12px 0 16px", fontSize: 13 }}
    >
      {exportErr ?? exportMsg}
    </p>
  );

  if (state.status === "loading" && orders.length === 0) {
    return (
      <div>
        {header}
        <div className="overview-loading">Wird geladen…</div>
      </div>
    );
  }

  if (state.status === "error" && orders.length === 0) {
    return (
      <div>
        {header}
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

  const hasOrders = orders.length > 0;

  return (
    <div>
      {header}
      {exportStatus}

      <div className="stats-kpi-grid">
        <StatCard label="Umsatz" value={eur.format(stats.revenue)} accent />
        <StatCard label="Bestellungen" value={int.format(stats.orderCount)} />
        <StatCard label="Artikel verkauft" value={int.format(stats.itemCount)} />
        <StatCard label="Ø Bestellwert" value={eur.format(stats.avgOrderValue)} />
        <StatCard
          label="Aktive Kellner"
          value={`${int.format(stats.activeWaiters)} / ${int.format(waiterName.size)}`}
        />
        <StatCard label="Tische" value={int.format(tableCount)} />
      </div>

      {!hasOrders ? (
        <div
          className="overview-card"
          style={{ textAlign: "center", padding: "40px 24px", marginTop: 16 }}
        >
          <p className="muted">
            Noch keine Bestellungen — Statistiken erscheinen, sobald bestellt wird.
          </p>
        </div>
      ) : (
        <div className="stats-charts">
          <div className="overview-card chart-card chart-card--wide">
            <div className="chart-card__header">
              <span className="section-title">Bestellungen im Zeitverlauf</span>
              <label className="chart-interval">
                <span className="chart-interval__label">Intervall</span>
                <select
                  className="form-input chart-interval__select"
                  value={String(bucketChoice)}
                  onChange={(e) =>
                    setBucketChoice(
                      e.target.value === "auto" ? "auto" : Number(e.target.value),
                    )
                  }
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={String(opt.value)} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <TimeBarChart buckets={buckets} />
          </div>

          <div className="overview-card chart-card">
            <span className="section-title">Top-Artikel nach Umsatz</span>
            <RankedBars
              rows={stats.topItems}
              valueFormat={(n) => eur.format(n)}
              secondaryLabel={(n) => `${int.format(n)}× verkauft`}
            />
          </div>

          <div className="overview-card chart-card">
            <span className="section-title">Umsatz pro Kellner</span>
            <RankedBars
              rows={stats.byWaiter}
              valueFormat={(n) => eur.format(n)}
              secondaryLabel={(n) =>
                `${int.format(n)} ${n === 1 ? "Bestellung" : "Bestellungen"}`
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
