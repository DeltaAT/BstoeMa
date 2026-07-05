import {
  AnnouncementCreateRequest,
  AnnouncementCreateRequestSchema,
  AnnouncementCreateResponseSchema,
  AnnouncementsQuery,
  AnnouncementsQuerySchema,
  AnnouncementsResponseSchema,
  ApiErrorEnvelopeSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { announcementStore } from "../domain/state";

export function registerAnnouncementRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AnnouncementsQuery }>(
    "/announcements",
    {
      config: {
        requiresAuth: true,
        allowedRoles: ["admin", "waiter"],
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["announcements"],
        operationId: "announcementsList",
        summary: "Ansagen auflisten",
        description:
          "Liefert Ansagen des aktiven Events. Mit ?since=<id> nur neuere Eintraege.",
        security: [{ bearerAuth: [] }],
        querystring: AnnouncementsQuerySchema,
        response: {
          200: AnnouncementsResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => ({
      announcements: announcementStore.list(request.query),
    })
  );

  app.post<{ Body: AnnouncementCreateRequest }>(
    "/announcements",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["announcements"],
        operationId: "announcementsCreate",
        summary: "Neue Ansage erstellen",
        description: "Erstellt eine Ansage, die alle Kellner sehen.",
        security: [{ bearerAuth: [] }],
        body: AnnouncementCreateRequestSchema,
        response: {
          201: AnnouncementCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const createdBy = request.auth.username ?? request.auth.role;

      const created = announcementStore.create(request.body, createdBy);

      app.log.info(
        { announcementId: created.id, severity: created.severity },
        `Ansage erstellt: ${created.message}`
      );

      return reply.status(201).send(created);
    }
  );
}
