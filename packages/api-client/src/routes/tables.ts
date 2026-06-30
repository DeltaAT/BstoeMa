import {
  TableBulkCreateRequestSchema,
  TableBulkCreateResponseSchema,
  TableCreateRequestSchema,
  TableCreateResponseSchema,
  TablesResponseSchema,
  TableUpdateRequestSchema,
  TableUpdateResponseSchema,
  type TableBulkCreateRequest,
  type TableBulkCreateResponse,
  type TableCreateRequest,
  type TableCreateResponse,
  type TablesQuery,
  type TablesResponse,
  type TableUpdateRequest,
  type TableUpdateResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface TablesClient {
  list(query?: TablesQuery): Promise<TablesResponse>;
  create(body: TableCreateRequest): Promise<TableCreateResponse>;
  bulkCreate(body: TableBulkCreateRequest): Promise<TableBulkCreateResponse>;
  update(tableId: number, body: TableUpdateRequest): Promise<TableUpdateResponse>;
  /** Returns the QR code for a single table as an SVG string. */
  getQrSvg(tableId: number): Promise<string>;
  /** Returns a PDF containing QR codes for tables of the active event.
   *  `layout`: `"single"` (1 table/page) or `"double"` (2 tables/page, default).
   *  `tableIds`: limit the export to these tables; omit/empty to export all. */
  getQrPdf(options?: {
    layout?: "single" | "double";
    tableIds?: number[];
  }): Promise<Blob>;
  /** Returns a single-page PDF with the QR code for one table. */
  getTableQrPdf(tableId: number): Promise<Blob>;
}

export function createTablesClient(http: HttpTransport): TablesClient {
  return {
    list: (query) =>
      http.get(TablesResponseSchema, "/tables", {
        locked: query?.locked,
        sort: query?.sort,
      }),

    create: (body) =>
      http.post(TableCreateResponseSchema, "/tables", TableCreateRequestSchema.parse(body)),

    bulkCreate: (body) =>
      http.post(
        TableBulkCreateResponseSchema,
        "/tables/bulk",
        TableBulkCreateRequestSchema.parse(body),
      ),

    update: (tableId, body) =>
      http.patch(
        TableUpdateResponseSchema,
        `/tables/${tableId}`,
        TableUpdateRequestSchema.parse(body),
      ),

    getQrSvg: (tableId) =>
      http.getText(`/tables/${tableId}/qr`),

    getQrPdf: (options) =>
      http.getBlob("/tables/qr.pdf", {
        ...(options?.layout ? { layout: options.layout } : {}),
        ...(options?.tableIds && options.tableIds.length > 0
          ? { tableIds: options.tableIds.join(",") }
          : {}),
      }),

    getTableQrPdf: (tableId) =>
      http.getBlob(`/tables/${tableId}/qr.pdf`),
  };
}
