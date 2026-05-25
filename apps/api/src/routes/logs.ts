import {
  ApiErrorEnvelopeSchema,
  LogsQuery,
  LogsQuerySchema,
  LogsResponseSchema,
} from "@serva/shared-types";
import type { FastifyInstance } from "fastify";
import type { LogBuffer } from "../plugins/log-buffer";

export function registerLogRoutes(app: FastifyInstance, buffer: LogBuffer) {
  app.get<{ Querystring: LogsQuery }>(
    "/logs",
    {
      config: {
        requiresAuth: true,
        allowedRoles: ["master", "admin"],
      },
      schema: {
        tags: ["ops"],
        operationId: "getLogs",
        summary: "Backend-Logs abrufen",
        description:
          "Liefert die zuletzt im Backend erzeugten Log-Eintraege (In-Memory-Ringpuffer). " +
          "Mit ?since=<id> koennen nur neuere Eintraege geholt werden.",
        security: [{ bearerAuth: [] }],
        querystring: LogsQuerySchema,
        response: {
          200: LogsResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => buffer.query(request.query)
  );
}
