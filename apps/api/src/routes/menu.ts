import {
  ApiErrorEnvelopeSchema,
  MenuCategoryCreateRequest,
  MenuCategoryCreateRequestSchema,
  MenuCategoryCreateResponseSchema,
  MenuCategoryParams,
  MenuCategoryParamsSchema,
  MenuCategoryUpdateRequest,
  MenuCategoryUpdateRequestSchema,
  MenuCategoryUpdateResponseSchema,
  MenuCategoriesQuery,
  MenuCategoriesQuerySchema,
  MenuCategoriesResponseSchema,
  MenuItemCreateRequest,
  MenuItemCreateRequestSchema,
  MenuItemCreateResponseSchema,
  MenuItemParams,
  MenuItemParamsSchema,
  MenuItemUpdateRequest,
  MenuItemUpdateRequestSchema,
  MenuItemUpdateResponseSchema,
  MenuItemsQuery,
  MenuItemsQuerySchema,
  MenuItemsResponseSchema,
  MenuExportSchema,
  MenuImportRequest,
  MenuImportRequestSchema,
  MenuImportResponseSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { menuStore } from "../domain/state";

export function registerMenuRoutes(app: FastifyInstance) {
  app.get<{ Querystring: MenuCategoriesQuery }>(
    "/menu/categories",
    {
      config: {
        allowedRoles: ["waiter", "admin"],
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuCategoriesList",
        summary: "Menue-Kategorien auflisten",
        description:
          "Liefert Kategorien des aktiven Events. Query-Beispiele: /menu/categories?locked=false und /menu/categories?includeRouting=true",
        security: [{ bearerAuth: [] }],
        querystring: MenuCategoriesQuerySchema,
        response: {
          200: MenuCategoriesResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return {
        categories: menuStore.listCategories({
          locked: request.query.locked,
          includeRouting: request.query.includeRouting,
        }),
      };
    }
  );

  app.get<{ Querystring: MenuItemsQuery }>(
    "/menu/items",
    {
      config: {
        allowedRoles: ["waiter", "admin"],
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuItemsList",
        summary: "Menue-Items auflisten",
        description:
          "Liefert Menue-Items des aktiven Events. Query-Beispiele: /menu/items?categoryId=2&sort=weight,name und /menu/items?locked=false",
        security: [{ bearerAuth: [] }],
        querystring: MenuItemsQuerySchema,
        response: {
          200: MenuItemsResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return {
        items: menuStore.listItems({
          categoryId: request.query.categoryId,
          locked: request.query.locked,
        }),
      };
    }
  );

  app.post<{ Body: MenuCategoryCreateRequest }>(
    "/menu/categories",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuCategoriesCreate",
        summary: "Menue-Kategorie erstellen",
        description:
          "Erstellt eine Kategorie. Beispiel-Body: { name: 'Desserts', weight: 10, isLocked: false }",
        security: [{ bearerAuth: [] }],
        body: MenuCategoryCreateRequestSchema,
        response: {
          201: MenuCategoryCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = menuStore.createCategory(request.body);
      return reply.status(201).send(created);
    }
  );

  app.patch<{ Params: MenuCategoryParams; Body: MenuCategoryUpdateRequest }>(
    "/menu/categories/:categoryId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuCategoriesUpdate",
        summary: "Menue-Kategorie aktualisieren",
        description: "Aktualisiert Name, Beschreibung, Lock-Status, Gewicht und Routing-Felder.",
        security: [{ bearerAuth: [] }],
        params: MenuCategoryParamsSchema,
        body: MenuCategoryUpdateRequestSchema,
        response: {
          200: MenuCategoryUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return menuStore.updateCategory(request.params.categoryId, request.body);
    }
  );

  app.delete<{ Params: MenuCategoryParams }>(
    "/menu/categories/:categoryId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuCategoriesDelete",
        summary: "Menue-Kategorie loeschen",
        description: "Loescht eine Kategorie. Wenn noch Items enthalten sind, kommt ein Konfliktfehler.",
        security: [{ bearerAuth: [] }],
        params: MenuCategoryParamsSchema,
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
      menuStore.deleteCategory(request.params.categoryId);
      return reply.status(204).send();
    }
  );

  app.post<{ Body: MenuItemCreateRequest }>(
    "/menu/items",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuItemsCreate",
        summary: "Menue-Item erstellen",
        description:
          "Erstellt ein Menue-Item. Beispiel-Body: { name: 'Cake', price: 5.9, menuCategoryId: 3 }",
        security: [{ bearerAuth: [] }],
        body: MenuItemCreateRequestSchema,
        response: {
          201: MenuItemCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = menuStore.createItem(request.body);
      return reply.status(201).send(created);
    }
  );

  app.patch<{ Params: MenuItemParams; Body: MenuItemUpdateRequest }>(
    "/menu/items/:menuItemId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuItemsUpdate",
        summary: "Menue-Item aktualisieren",
        description: "Aktualisiert Felder eines Menue-Items inkl. Kategorie-Wechsel und Lock-Status.",
        security: [{ bearerAuth: [] }],
        params: MenuItemParamsSchema,
        body: MenuItemUpdateRequestSchema,
        response: {
          200: MenuItemUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return menuStore.updateItem(request.params.menuItemId, request.body);
    }
  );

  app.delete<{ Params: MenuItemParams }>(
    "/menu/items/:menuItemId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuItemsDelete",
        summary: "Menue-Item loeschen",
        description: "Loescht ein Menue-Item aus dem aktiven Event.",
        security: [{ bearerAuth: [] }],
        params: MenuItemParamsSchema,
        response: {
          204: z.null(),
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      menuStore.deleteItem(request.params.menuItemId);
      return reply.status(204).send();
    }
  );

  app.get(
    "/menu/export",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuExport",
        summary: "Speisekarte exportieren",
        description:
          "Exportiert die komplette Speisekarte (Kategorien inkl. Artikel) des aktiven Events als portable JSON-Struktur. Drucker-/Display-Zuordnungen werden bewusst nicht mit exportiert.",
        security: [{ bearerAuth: [] }],
        response: {
          200: MenuExportSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => menuStore.exportMenu()
  );

  app.post<{ Body: MenuImportRequest }>(
    "/menu/import",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["menu"],
        operationId: "menuImport",
        summary: "Speisekarte importieren",
        description:
          "Importiert eine exportierte Speisekarte in das aktive Event. mode='merge' (Standard) fuegt Kategorien/Artikel per Name zusammen (idempotent); mode='replace' ersetzt die bestehende Speisekarte vollstaendig.",
        security: [{ bearerAuth: [] }],
        body: MenuImportRequestSchema,
        response: {
          200: MenuImportResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      menuStore.importMenu({ menu: request.body.menu, mode: request.body.mode })
  );
}

