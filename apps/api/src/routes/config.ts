import {
  ApiErrorEnvelopeSchema,
  ConfigGetResponseSchema,
  ConfigPatchRequest,
  ConfigPatchRequestSchema,
  ConfigPatchResponseSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { configStore } from "../domain/state";

export function registerConfigRoutes(app: FastifyInstance) {
  app.get(
    "/config",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["config"],
        operationId: "configGet",
        summary: "Konfiguration abrufen",
        description: "Liefert alle Konfigurationswerte des aktiven Events als key-value Objekt.",
        security: [{ bearerAuth: [] }],
        response: {
          200: ConfigGetResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => ({ values: configStore.listValues() })
  );

  app.patch<{ Body: ConfigPatchRequest }>(
    "/config",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["config"],
        operationId: "configPatch",
        summary: "Konfiguration setzen",
        description:
          "Setzt/ueberschreibt Konfigurationswerte des aktiven Events. Beispiel: { values: { currency: 'EUR' } }",
        security: [{ bearerAuth: [] }],
        body: ConfigPatchRequestSchema,
        response: {
          200: ConfigPatchResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => ({ values: configStore.patchValues(request.body) })
  );
}

