import {
  ApiErrorEnvelopeSchema,
  OrderDisplayCreateRequest,
  OrderDisplayCreateRequestSchema,
  OrderDisplayCreateResponseSchema,
  OrderDisplayGetResponseSchema,
  OrderDisplayParams,
  OrderDisplayParamsSchema,
  OrderDisplaysResponseSchema,
  OrderDisplayUpdateRequest,
  OrderDisplayUpdateRequestSchema,
  OrderDisplayUpdateResponseSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { orderDisplayStore } from "../domain/state";

export function registerOrderDisplayRoutes(app: FastifyInstance) {
  app.get(
    "/order-displays",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["order-displays"],
        operationId: "orderDisplaysList",
        summary: "Bestellanzeigen auflisten",
        description: "Liefert alle konfigurierten Bestellanzeigen des aktiven Events.",
        security: [{ bearerAuth: [] }],
        response: {
          200: OrderDisplaysResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => ({ orderDisplays: orderDisplayStore.listOrderDisplays() })
  );

  app.post<{ Body: OrderDisplayCreateRequest }>(
    "/order-displays",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["order-displays"],
        operationId: "orderDisplaysCreate",
        summary: "Bestellanzeige erstellen",
        description: "Erstellt eine Bestellanzeige (Routing-Ziel fuer Menuekategorien).",
        security: [{ bearerAuth: [] }],
        body: OrderDisplayCreateRequestSchema,
        response: {
          201: OrderDisplayCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = orderDisplayStore.createOrderDisplay(request.body);
      return reply.status(201).send(created);
    }
  );

  app.get<{ Params: OrderDisplayParams }>(
    "/order-displays/:orderDisplayId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["order-displays"],
        operationId: "orderDisplaysGetById",
        summary: "Bestellanzeige per ID abrufen",
        description: "Liefert die Konfiguration einer einzelnen Bestellanzeige.",
        security: [{ bearerAuth: [] }],
        params: OrderDisplayParamsSchema,
        response: {
          200: OrderDisplayGetResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => orderDisplayStore.getOrderDisplay(request.params.orderDisplayId)
  );

  app.patch<{ Params: OrderDisplayParams; Body: OrderDisplayUpdateRequest }>(
    "/order-displays/:orderDisplayId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["order-displays"],
        operationId: "orderDisplaysUpdate",
        summary: "Bestellanzeige aktualisieren",
        description:
          "Aktualisiert Name, IP-Adresse oder connectionDetails einer Bestellanzeige.",
        security: [{ bearerAuth: [] }],
        params: OrderDisplayParamsSchema,
        body: OrderDisplayUpdateRequestSchema,
        response: {
          200: OrderDisplayUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      orderDisplayStore.updateOrderDisplay(request.params.orderDisplayId, request.body)
  );

  app.delete<{ Params: OrderDisplayParams }>(
    "/order-displays/:orderDisplayId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["order-displays"],
        operationId: "orderDisplaysDelete",
        summary: "Bestellanzeige loeschen",
        description:
          "Loescht eine Bestellanzeige. Wenn sie noch einer Menuekategorie zugewiesen ist, wird ein Konfliktfehler zurueckgegeben.",
        security: [{ bearerAuth: [] }],
        params: OrderDisplayParamsSchema,
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
      orderDisplayStore.deleteOrderDisplay(request.params.orderDisplayId);
      return reply.status(204).send();
    }
  );
}
