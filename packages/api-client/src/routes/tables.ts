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
  /** Returns a PDF containing QR codes for all tables.
   *  `layout`: `"single"` (1 table/page) or `"double"` (2 tables/page, default). */
  getQrPdf(layout?: "single" | "double"): Promise<Blob>;
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

    getQrPdf: (layout) =>
      http.getBlob("/tables/qr.pdf", layout ? { layout } : undefined),
  };
}
