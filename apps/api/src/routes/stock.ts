import {
  ApiErrorEnvelopeSchema,
  MenuItemParams,
  MenuItemParamsSchema,
  MenuItemStockRequirementsReplaceRequest,
  MenuItemStockRequirementsReplaceRequestSchema,
  MenuItemStockRequirementsReplaceResponseSchema,
  StockItemCreateRequest,
  StockItemCreateRequestSchema,
  StockItemCreateResponseSchema,
  StockItemParams,
  StockItemParamsSchema,
  StockItemsResponseSchema,
  StockItemUpdateRequest,
  StockItemUpdateRequestSchema,
  StockItemUpdateResponseSchema,
} from "@serva/shared-types";
import type { FastifyInstance } from "fastify";
import { stockStore } from "../domain/state";

export function registerStockRoutes(app: FastifyInstance) {
  app.get(
    "/stock/items",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["stock"],
        operationId: "stockItemsList",
        summary: "Lagerartikel auflisten",
        description: "Liefert alle Lagerartikel des aktiven Events sortiert nach Name.",
        security: [{ bearerAuth: [] }],
        response: {
          200: StockItemsResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => ({ items: stockStore.listItems() })
  );

  app.post<{ Body: StockItemCreateRequest }>(
    "/stock/items",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["stock"],
        operationId: "stockItemsCreate",
        summary: "Lagerartikel erstellen",
        description:
          "Erstellt einen Lagerartikel. Beispiel-Body: { name: 'Tomato', quantity: 20 }",
        security: [{ bearerAuth: [] }],
        body: StockItemCreateRequestSchema,
        response: {
          201: StockItemCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = stockStore.createItem(request.body);
      return reply.status(201).send(created);
    }
  );

  app.patch<{ Params: StockItemParams; Body: StockItemUpdateRequest }>(
    "/stock/items/:stockItemId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["stock"],
        operationId: "stockItemsUpdateQuantity",
        summary: "Lagerbestand aktualisieren",
        description:
          "Aktualisiert den Bestand ueber absoluten Wert (quantity) oder Delta (delta). Beispiele: { quantity: 42 } oder { delta: -3 }",
        security: [{ bearerAuth: [] }],
        params: StockItemParamsSchema,
        body: StockItemUpdateRequestSchema,
        response: {
          200: StockItemUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => stockStore.updateItem(request.params.stockItemId, request.body)
  );

  app.get<{ Params: MenuItemParams }>(
    "/menu/items/:menuItemId/stock-requirements",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["stock"],
        operationId: "menuItemsGetStockRequirements",
        summary: "Stock-Anforderungen eines Menue-Items abrufen",
        description: "Gibt die aktuellen Stock-Anforderungen eines Menue-Items zurueck.",
        security: [{ bearerAuth: [] }],
        params: MenuItemParamsSchema,
        response: {
          200: MenuItemStockRequirementsReplaceResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => stockStore.getMenuItemRequirements(request.params.menuItemId)
  );

  app.put<{ Params: MenuItemParams; Body: MenuItemStockRequirementsReplaceRequest }>(
    "/menu/items/:menuItemId/stock-requirements",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["stock"],
        operationId: "menuItemsReplaceStockRequirements",
        summary: "Stock-Anforderungen eines Menue-Items ersetzen",
        description:
          "Ersetzt die komplette Liste der Stock-Anforderungen fuer ein Menue-Item. Leeres Array entfernt alle Anforderungen.",
        security: [{ bearerAuth: [] }],
        params: MenuItemParamsSchema,
        body: MenuItemStockRequirementsReplaceRequestSchema,
        response: {
          200: MenuItemStockRequirementsReplaceResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => stockStore.replaceMenuItemRequirements(request.params.menuItemId, request.body)
  );
}

