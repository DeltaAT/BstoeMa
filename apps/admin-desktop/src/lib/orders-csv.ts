import type { OrdersExportResponse, OrdersExportRow } from "@serva/shared-types";

// Builds an RFC-4180 CSV from the flat orders export: comma-delimited, CRLF
// line endings, fields quoted only when needed. Numbers keep the dot decimal
// separator and timestamps stay ISO-8601 so the file imports cleanly into
// analysis tools (pandas, R, Excel import wizard). A UTF-8 BOM is prepended so
// Excel detects the encoding and umlauts survive a plain double-click open.

const COLUMNS: Array<{ header: string; value: (r: OrdersExportRow) => string | number }> = [
  { header: "orderId", value: (r) => r.orderId },
  { header: "timestamp", value: (r) => r.timestamp },
  { header: "tableId", value: (r) => r.tableId },
  { header: "tableName", value: (r) => r.tableName },
  { header: "userId", value: (r) => r.userId },
  { header: "waiterUsername", value: (r) => r.waiterUsername },
  { header: "menuItemId", value: (r) => r.menuItemId },
  { header: "menuItemName", value: (r) => r.menuItemName },
  { header: "categoryName", value: (r) => r.categoryName },
  { header: "quantity", value: (r) => r.quantity },
  { header: "unitPrice", value: (r) => r.unitPrice },
  { header: "lineTotal", value: (r) => r.lineTotal },
  { header: "specialRequests", value: (r) => r.specialRequests },
];

function escapeField(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildOrdersCsv(data: OrdersExportResponse): string {
  const lines = [COLUMNS.map((c) => c.header).join(",")];
  for (const row of data.rows) {
    lines.push(COLUMNS.map((c) => escapeField(c.value(row))).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
