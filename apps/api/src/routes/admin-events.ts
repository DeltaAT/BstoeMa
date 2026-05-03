import {
  AdminEventActivateResponseSchema,
  AdminEventCreateRequest,
  AdminEventCreateRequestSchema,
  AdminEventCreateResponseSchema,
  AdminEventDeactivateResponseSchema,
  ApiErrorEnvelopeSchema,
  ActiveEventResponseSchema,
  EventListResponseSchema,
  EventPasscodeResponseSchema,
  RotatePasscodeRequest,
  RotatePasscodeRequestSchema,
  RotatePasscodeResponseSchema,
} from "@serva/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eventStore } from "../domain/state";
import { ApiError } from "../domain/api-error";

const EventIdParamsSchema = z.object({
  eventId: z.coerce.number().int().positive().describe("Event-ID. Beispiel: 42"),
});
type EventIdParams = z.infer<typeof EventIdParamsSchema>;

function toEventDto(event: {
  id: number;
  eventName: string;
  adminUsername: string;
  isActive: boolean;
  createdAt: string;
  closedAt?: string;
}) {
  return {
    id: event.id,
    eventName: event.eventName,
    adminUsername: event.adminUsername,
    isActive: event.isActive,
    createdAt: event.createdAt,
    closedAt: event.closedAt,
  };
}

export function registerAdminEventRoutes(app: FastifyInstance) {
  app.post<{ Body: AdminEventCreateRequest }>(
    "/admin/events",
    {
      config: {
        requiresRole: "master",
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsCreate",
        summary: "Neues Event erstellen",
        description:
          "Legt ein neues Event inklusive eigener Event-Datenbank und initialem Admin-Account an.",
        security: [{ bearerAuth: [] }],
        body: AdminEventCreateRequestSchema,
        response: {
          201: AdminEventCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          500: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = eventStore.createEvent(request.body);
      return reply.status(201).send(toEventDto(created));
    }
  );

  app.post<{ Params: EventIdParams }>(
    "/admin/events/:eventId/activate",
    {
      config: {
        requiresRole: "master",
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsActivate",
        summary: "Event aktivieren",
        description:
          "Aktiviert das angegebene Event global. Ein zuvor aktives Event wird automatisch deaktiviert.",
        security: [{ bearerAuth: [] }],
        params: EventIdParamsSchema,
        response: {
          200: AdminEventActivateResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => toEventDto(eventStore.activateEvent(request.params.eventId))
  );

  app.post<{ Params: EventIdParams }>(
    "/admin/events/:eventId/deactivate",
    {
      config: {
        requiresRole: "master",
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsDeactivate",
        summary: "Event deaktivieren",
        description: "Deaktiviert das angegebene Event, ohne es zu loeschen.",
        security: [{ bearerAuth: [] }],
        params: EventIdParamsSchema,
        response: {
          200: AdminEventDeactivateResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => toEventDto(eventStore.deactivateEvent(request.params.eventId))
  );

  app.post<{ Params: EventIdParams }>(
    "/admin/events/:eventId/close",
    {
      config: {
        requiresRole: "master",
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsClose",
        summary: "Event schliessen",
        description:
          "Schliesst das Event fachlich (setzt closedAt) und deaktiviert es falls noetig.",
        security: [{ bearerAuth: [] }],
        params: EventIdParamsSchema,
        response: {
          200: AdminEventDeactivateResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => toEventDto(eventStore.closeEvent(request.params.eventId))
  );

  app.get(
    "/admin/events",
    {
      config: { requiresRole: "master" },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsList",
        summary: "Alle Events abrufen",
        description: "Liefert alle Events sortiert nach ID absteigend.",
        security: [{ bearerAuth: [] }],
        response: {
          200: EventListResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => eventStore.listAllEvents().map(toEventDto)
  );

  app.get(
    "/admin/events/active",
    {
      config: {
        requiresRole: "master",
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsGetActive",
        summary: "Aktives Event abrufen",
        description:
          "Liefert das aktuell aktive Event. Gibt NO_ACTIVE_EVENT zurueck, wenn keines aktiv ist.",
        security: [{ bearerAuth: [] }],
        response: {
          200: ActiveEventResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async () => {
      const activeEvent = eventStore.getActiveEvent();
      if (!activeEvent) {
        throw new ApiError(
          409,
          "NO_ACTIVE_EVENT",
          "No active event exists. Activate an event first."
        );
      }

      return toEventDto(activeEvent);
    }
  );

  app.delete<{ Params: EventIdParams }>(
    "/admin/events/:eventId",
    {
      config: {
        requiresRole: "master",
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventsDelete",
        summary: "Event loeschen",
        description:
          "Loescht ein Event inklusive zugehoeriger Event-Datenbank. Wenn das Event aktiv war, bleibt danach kein aktives Event.",
        security: [{ bearerAuth: [] }],
        params: EventIdParamsSchema,
        response: {
          204: z.null(),
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          500: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      eventStore.deleteEvent(request.params.eventId);
      return reply.status(204).send();
    }
  );

  // ---------------------------------------------------------------------------
  // Passcode management (admin-scoped)
  // ---------------------------------------------------------------------------

  app.get(
    "/admin/event-passcode",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventGetPasscode",
        summary: "Passcode des aktiven Events abrufen",
        description:
          "Gibt den aktuellen Klartext-Passcode des aktiven Events zurueck. Nur fuer eingeloggte Admins des jeweiligen Events.",
        security: [{ bearerAuth: [] }],
        response: {
          200: EventPasscodeResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const activeEvent = eventStore.getActiveEvent();
      if (!activeEvent) {
        throw new ApiError(409, "NO_ACTIVE_EVENT", "No active event exists. Activate an event first.");
      }
      if (request.auth.eventId !== activeEvent.id) {
        throw new ApiError(403, "FORBIDDEN", "Token is bound to a different event");
      }

      const passcode = eventStore.getActiveEventPasscode();
      if (passcode === null) {
        // Pre-migration event: plaintext was never stored. Force the admin to rotate.
        throw new ApiError(
          409,
          "PASSCODE_NOT_SET",
          "Passcode not initialised. Please rotate the passcode to set a new one."
        );
      }

      return { passcode };
    }
  );

  app.put<{ Body: RotatePasscodeRequest }>(
    "/admin/event-passcode",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["admin-events"],
        operationId: "adminEventRotatePasscode",
        summary: "Passcode des aktiven Events rotieren",
        description:
          "Setzt einen neuen Passcode fuer das aktive Event. Bestehende Waiter-Tokens bleiben gueltig bis zum Ablauf; neue Logins erfordern den neuen Passcode.",
        security: [{ bearerAuth: [] }],
        body: RotatePasscodeRequestSchema,
        response: {
          200: RotatePasscodeResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          422: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const activeEvent = eventStore.getActiveEvent();
      if (!activeEvent) {
        throw new ApiError(409, "NO_ACTIVE_EVENT", "No active event exists. Activate an event first.");
      }
      if (request.auth.eventId !== activeEvent.id) {
        throw new ApiError(403, "FORBIDDEN", "Token is bound to a different event");
      }

      const passcode = eventStore.rotateActiveEventPasscode(request.body.newPasscode);
      return { passcode };
    }
  );
}

