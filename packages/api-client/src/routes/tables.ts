import {
  TableBulkCreateRequestSchema,
  TableBulkCreateResponseSchema,
  TableCreateRequestSchema,
  TableCreateResponseSchema,
  TablesResponseSchema,
  TableUpdateRequestSchema,
  TableUpdateResponseSchema,
  type QrPdfBranding,
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
   *  `tableIds`: limit the export to these tables; omit/empty to export all.
   *  `branding`: optional footer with the Serva logo/URL or a custom logo+label. */
  getQrPdf(options?: {
    layout?: "single" | "double";
    tableIds?: number[];
    branding?: QrPdfBranding;
  }): Promise<Blob>;
  /** Same as {@link getQrPdf} but streams generation progress: `onProgress`
   *  is called with `(done, total)` as each table is rendered server-side, and
   *  the promise resolves with the finished PDF Blob. Use this to drive a
   *  progress bar / ETA in the UI; falls back to the same result as `getQrPdf`. */
  getQrPdfWithProgress(
    options: {
      layout?: "single" | "double";
      tableIds?: number[];
      branding?: QrPdfBranding;
    },
    onProgress: (done: number, total: number) => void,
  ): Promise<Blob>;
  /** Returns a single-page PDF with the QR code for one table. */
  getTableQrPdf(tableId: number): Promise<Blob>;
}

/** Builds the request body shared by the plain and streaming QR-PDF exports,
 *  omitting empty/absent fields so the API sees a clean payload. */
function qrPdfBody(options?: {
  layout?: "single" | "double";
  tableIds?: number[];
  branding?: QrPdfBranding;
}): Record<string, unknown> {
  return {
    ...(options?.layout ? { layout: options.layout } : {}),
    ...(options?.tableIds && options.tableIds.length > 0
      ? { tableIds: options.tableIds }
      : {}),
    ...(options?.branding ? { branding: options.branding } : {}),
  };
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

    getQrPdf: (options) => http.postBlob("/tables/qr.pdf", qrPdfBody(options)),

    getQrPdfWithProgress: (options, onProgress) =>
      http.postProgressBlob("/tables/qr.pdf/stream", qrPdfBody(options), onProgress),

    getTableQrPdf: (tableId) =>
      http.getBlob(`/tables/${tableId}/qr.pdf`),
  };
}
