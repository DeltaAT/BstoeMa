import {
  ApiErrorEnvelopeSchema,
  PrinterCreateRequest,
  PrinterCreateRequestSchema,
  PrinterCreateResponseSchema,
  PrinterGetResponseSchema,
  PrinterParams,
  PrinterParamsSchema,
  PrintersResponseSchema,
  PrinterTestPrintResponseSchema,
  PrinterUpdateRequest,
  PrinterUpdateRequestSchema,
  PrinterUpdateResponseSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { printerStore } from "../domain/state";

export function registerPrinterRoutes(app: FastifyInstance) {
  app.get(
    "/printers",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["printers"],
        operationId: "printersList",
        summary: "Printer auflisten",
        description: "Liefert alle konfigurierten Thermodrucker des aktiven Events.",
        security: [{ bearerAuth: [] }],
        response: {
          200: PrintersResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => ({ printers: printerStore.listPrinters() })
  );

  app.post<{ Body: PrinterCreateRequest }>(
    "/printers",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["printers"],
        operationId: "printersCreate",
        summary: "Printer erstellen",
        description:
          "Erstellt einen Thermodrucker. connectionDetails kann z. B. den TCP-Port enthalten (Standard 9100).",
        security: [{ bearerAuth: [] }],
        body: PrinterCreateRequestSchema,
        response: {
          201: PrinterCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = printerStore.createPrinter(request.body);
      return reply.status(201).send(created);
    }
  );

  app.get<{ Params: PrinterParams }>(
    "/printers/:printerId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["printers"],
        operationId: "printersGetById",
        summary: "Printer per ID abrufen",
        description: "Liefert die Konfiguration eines einzelnen Thermodruckers.",
        security: [{ bearerAuth: [] }],
        params: PrinterParamsSchema,
        response: {
          200: PrinterGetResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => printerStore.getPrinter(request.params.printerId)
  );

  app.patch<{ Params: PrinterParams; Body: PrinterUpdateRequest }>(
    "/printers/:printerId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["printers"],
        operationId: "printersUpdate",
        summary: "Printer aktualisieren",
        description:
          "Aktualisiert Name, IP-Adresse oder connectionDetails eines Thermodruckers.",
        security: [{ bearerAuth: [] }],
        params: PrinterParamsSchema,
        body: PrinterUpdateRequestSchema,
        response: {
          200: PrinterUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => printerStore.updatePrinter(request.params.printerId, request.body)
  );

  app.delete<{ Params: PrinterParams }>(
    "/printers/:printerId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["printers"],
        operationId: "printersDelete",
        summary: "Printer loeschen",
        description:
          "Loescht einen Thermodrucker. Wenn der Drucker noch einer Menuekategorie zugewiesen ist, wird ein Konfliktfehler zurueckgegeben.",
        security: [{ bearerAuth: [] }],
        params: PrinterParamsSchema,
        response: {
          204: z.null(),
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      printerStore.deletePrinter(request.params.printerId);
      return reply.status(204).send();
    }
  );

  app.post<{ Params: PrinterParams }>(
    "/printers/:printerId/test-print",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["printers"],
        operationId: "printersTestPrint",
        summary: "Testdruck senden",
        description:
          "Verbindet sich mit dem Drucker und sendet einen einfachen ESC/POS-Testbeleg. Bei Netzwerkproblemen werden verstaendliche Fehlercodes mit Details geliefert.",
        security: [{ bearerAuth: [] }],
        params: PrinterParamsSchema,
        response: {
          200: PrinterTestPrintResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => printerStore.sendTestPrint(request.params.printerId)
  );
}

