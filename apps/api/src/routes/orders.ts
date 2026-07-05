import {
  ApiErrorEnvelopeSchema,
  OrderGetResponseSchema,
  OrderParams,
  OrderParamsSchema,
  OrderPrintResponseSchema,
  OrdersExportResponseSchema,
  OrdersQuery,
  OrdersQuerySchema,
  OrdersResponseSchema,
  OrderSubmitRequest,
  OrderSubmitRequestSchema,
  OrderSubmitResponseSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../domain/api-error";
import { configStore, orderStore, printerStore } from "../domain/state";

// Default to "auto print on" — matches the issue acceptance criteria. The
// admin can flip the `order.printTickets` config to "false" to disable.
function isPrintingEnabled(): boolean {
  try {
    const values = configStore.listValues();
    const raw = values["order.printTickets"];
    if (raw === undefined) return true;
    return raw.trim().toLowerCase() !== "false";
  } catch {
    // No active event → guard handles it before we get here.
    return true;
  }
}

export function registerOrderRoutes(app: FastifyInstance) {
  app.get<{ Querystring: OrdersQuery }>(
    "/orders",
    {
      config: {
        requiresAuth: true,
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["orders"],
        operationId: "ordersList",
        summary: "Bestellungen auflisten",
        description:
          "Liefert Bestellungen des aktiven Events. Waiter sehen nur eigene Bestellungen. Query: tableId, userId, from, to.",
        security: [{ bearerAuth: [] }],
        querystring: OrdersQuerySchema,
        response: {
          200: OrdersResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          423: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      if (request.auth.role === "master") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can access orders");
      }

      return {
        orders: orderStore.listOrders(request.query, {
          role: request.auth.role,
          username: request.auth.username,
        }),
      };
    }
  );

  app.get(
    "/orders/export",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["orders"],
        operationId: "ordersExport",
        summary: "Bestelldaten exportieren",
        description:
          "Liefert alle Bestellpositionen des aktiven Events als flache, denormalisierte Zeilen (inkl. Tisch-, Kellner-, Artikel- und Kategorienamen) fuer die Datenanalyse, z.B. als CSV-Export.",
        security: [{ bearerAuth: [] }],
        response: {
          200: OrdersExportResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => orderStore.exportOrders()
  );

  app.post<{ Body: OrderSubmitRequest }>(
    "/orders",
    {
      config: {
        requiresAuth: true,
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["orders"],
        operationId: "ordersCreate",
        summary: "Bestellung anlegen",
        description:
          "Erstellt eine neue Bestellung fuer den authentifizierten User. Locked Tables/Items/Categories erzeugen 409, Out-of-stock 422.",
        security: [{ bearerAuth: [] }],
        body: OrderSubmitRequestSchema,
        response: {
          201: OrderSubmitResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          423: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          422: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.auth.role === "master") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can submit orders");
      }

      const created = orderStore.submitOrder(request.body, {
        role: request.auth.role,
        username: request.auth.username,
      });
      return reply.status(201).send(created);
    }
  );

  app.post<{ Params: OrderParams }>(
    "/orders/:orderId/print",
    {
      config: {
        requiresAuth: true,
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["orders"],
        operationId: "ordersPrint",
        summary: "Bestellung drucken",
        description:
          "Druckt die Bons fuer eine Bestellung. Items werden nach zugewiesenem Drucker gruppiert. Wenn order.printTickets=false ist der Lauf no-op (printingEnabled=false). Pro Drucker wird ein Ergebnis zurueckgegeben — ein offline Drucker laesst die anderen Bons trotzdem laufen.",
        security: [{ bearerAuth: [] }],
        params: OrderParamsSchema,
        response: {
          200: OrderPrintResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          423: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      if (request.auth.role === "master") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can print orders");
      }

      // Reuse the existing ownership/lock checks: waiters can only print their
      // own orders. Throws 404 if the order doesn't exist.
      orderStore.getOrder(request.params.orderId, {
        role: request.auth.role,
        username: request.auth.username,
      });

      if (!isPrintingEnabled()) {
        return {
          orderId: request.params.orderId,
          printingEnabled: false,
          results: [],
        };
      }

      return printerStore.printOrder(request.params.orderId);
    }
  );

  app.get<{ Params: OrderParams }>(
    "/orders/:orderId",
    {
      config: {
        requiresAuth: true,
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["orders"],
        operationId: "ordersGetById",
        summary: "Bestellung im Detail abrufen",
        description:
          "Liefert Bestellung inkl. Items. Waiter duerfen nur eigene Bestellungen lesen.",
        security: [{ bearerAuth: [] }],
        params: OrderParamsSchema,
        response: {
          200: OrderGetResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          423: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      if (request.auth.role === "master") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can access orders");
      }

      return orderStore.getOrder(request.params.orderId, {
        role: request.auth.role,
        username: request.auth.username,
      });
    }
  );
}

