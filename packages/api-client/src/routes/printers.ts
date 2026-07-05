import {
  PrinterCreateRequestSchema,
  PrinterCreateResponseSchema,
  PrinterGetResponseSchema,
  PrintersResponseSchema,
  PrinterTestPrintResponseSchema,
  PrinterUpdateRequestSchema,
  PrinterUpdateResponseSchema,
  type PrinterCreateRequest,
  type PrinterCreateResponse,
  type PrinterGetResponse,
  type PrintersResponse,
  type PrinterTestPrintResponse,
  type PrinterUpdateRequest,
  type PrinterUpdateResponse,
} from "@bstoema/shared-types";
import type { HttpTransport } from "../http.js";

export interface PrintersClient {
  list(): Promise<PrintersResponse>;
  create(body: PrinterCreateRequest): Promise<PrinterCreateResponse>;
  getById(printerId: number): Promise<PrinterGetResponse>;
  update(printerId: number, body: PrinterUpdateRequest): Promise<PrinterUpdateResponse>;
  delete(printerId: number): Promise<void>;
  /** Send a test print to the printer at the given IP. On failure throws `ApiPrinterError`. */
  testPrint(printerId: number): Promise<PrinterTestPrintResponse>;
}

export function createPrintersClient(http: HttpTransport): PrintersClient {
  return {
    list: () =>
      http.get(PrintersResponseSchema, "/printers"),

    create: (body) =>
      http.post(
        PrinterCreateResponseSchema,
        "/printers",
        PrinterCreateRequestSchema.parse(body),
      ),

    getById: (printerId) =>
      http.get(PrinterGetResponseSchema, `/printers/${printerId}`),

    update: (printerId, body) =>
      http.patch(
        PrinterUpdateResponseSchema,
        `/printers/${printerId}`,
        PrinterUpdateRequestSchema.parse(body),
      ),

    delete: (printerId) =>
      http.deleteVoid(`/printers/${printerId}`),

    testPrint: (printerId) =>
      http.post(PrinterTestPrintResponseSchema, `/printers/${printerId}/test-print`),
  };
}
