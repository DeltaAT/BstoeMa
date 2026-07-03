import {
  AdminSessionStartRequest,
  AdminSessionStartRequestSchema,
  AdminSessionStartResponseSchema,
  ApiErrorEnvelopeSchema,
  AuthLoginRequest,
  AuthLoginRequestSchema,
  AuthLoginResponseSchema,
  AuthMeResponseSchema,
  MasterSessionStartRequest,
  MasterSessionStartRequestSchema,
  MasterSessionStartResponseSchema,
  MasterSetupRequest,
  MasterSetupRequestSchema,
  MasterSetupResponseSchema,
  MasterStatusResponseSchema,
} from "@serva/shared-types";
import type { FastifyInstance } from "fastify";
import { authStore } from "../domain/state";

// Master runs on the operator's own laptop and manages events globally, so it
// keeps a short 1h session. Admin and waiter sessions last a full shift (6h) so
// staff aren't logged out mid-service — see issue #129.
const MASTER_TOKEN_TTL_SECONDS = 60 * 60;
const SESSION_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export function registerAuthRoutes(app: FastifyInstance) {
  app.get(
    "/auth/master/status",
    {
      schema: {
        tags: ["auth"],
        operationId: "authMasterStatus",
        summary: "Master-Konfigurationsstatus",
        description:
          "Meldet, ob Master-Zugangsdaten konfiguriert sind. Wenn nicht, zeigt die App einen Ersteinrichtungs-Bildschirm.",
        security: [],
        response: {
          200: MasterStatusResponseSchema,
        },
      },
    },
    async () => ({ configured: authStore.isMasterConfigured() })
  );

  app.post<{ Body: MasterSetupRequest }>(
    "/auth/master/setup",
    {
      schema: {
        tags: ["auth"],
        operationId: "authMasterSetup",
        summary: "Master-Ersteinrichtung",
        description:
          "Legt einmalig die Master-Zugangsdaten an, solange noch keine konfiguriert sind. Beispiel-Body: { username: 'master', password: 'mind-8-zeichen' }",
        security: [],
        body: MasterSetupRequestSchema,
        response: {
          200: MasterSetupResponseSchema,
          400: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      authStore.setupMaster(request.body);
      return { configured: true as const };
    }
  );

  app.post<{ Body: MasterSessionStartRequest }>(
    "/auth/master/login",
    {
      schema: {
        tags: ["auth"],
        operationId: "authMasterLogin",
        summary: "Master-Login",
        description:
          "Globaler Login fuer Master-Operationen (z. B. Event anlegen/aktivieren/deaktivieren/loeschen). Beispiel-Body: { username: 'master', password: 'secret' }",
        security: [],
        body: MasterSessionStartRequestSchema,
        response: {
          200: MasterSessionStartResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          500: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      authStore.authenticateMaster(request.body);
      const accessToken = await app.jwt.sign(
        { role: "master" },
        { expiresIn: MASTER_TOKEN_TTL_SECONDS }
      );
      return {
        accessToken,
        expiresInSeconds: MASTER_TOKEN_TTL_SECONDS,
        role: "master" as const,
      };
    }
  );

  app.post<{ Body: AdminSessionStartRequest }>(
    "/auth/admin/login",
    {
      schema: {
        tags: ["auth"],
        operationId: "authAdminLogin",
        summary: "Admin-Login pro Event",
        description:
          "Login fuer Event-Admins mit eventId, username und password. Beispiel-Body: { eventId: 12, username: 'chef', password: 'secret123' }",
        security: [],
        body: AdminSessionStartRequestSchema,
        response: {
          200: AdminSessionStartResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          423: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          500: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const result = authStore.authenticateAdmin(request.body);
      const accessToken = await app.jwt.sign(
        {
          role: "admin",
          eventId: result.eventId,
          username: request.body.username,
        },
        { expiresIn: SESSION_TOKEN_TTL_SECONDS }
      );

      return {
        accessToken,
        expiresInSeconds: SESSION_TOKEN_TTL_SECONDS,
        role: "admin" as const,
        eventId: result.eventId,
      };
    }
  );

  app.post<{ Body: AuthLoginRequest }>(
    "/auth/login",
    {
      config: {
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["auth"],
        operationId: "authWaiterLogin",
        summary: "Waiter-Login mit Event-Passcode",
        description:
          "Waiter-Session-Start ohne individuelles Passwort. Beispiel-Body: { username: 'anna', eventPasscode: 'event-code' }",
        security: [],
        body: AuthLoginRequestSchema,
        response: {
          200: AuthLoginResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          423: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const waiter = authStore.loginWaiter(request.body);
      const accessToken = await app.jwt.sign(
        {
          role: "waiter",
          eventId: waiter.eventId,
          username: waiter.user.username,
        },
        { expiresIn: SESSION_TOKEN_TTL_SECONDS }
      );

      return {
        accessToken,
        expiresInSeconds: SESSION_TOKEN_TTL_SECONDS,
        role: "waiter" as const,
        eventId: waiter.eventId,
        user: {
          id: waiter.user.id,
          username: waiter.user.username,
          isLocked: waiter.user.isLocked,
        },
      };
    }
  );

  app.get(
    "/auth/me",
    {
      config: {
        requiresAuth: true,
      },
      schema: {
        tags: ["auth"],
        operationId: "authMe",
        summary: "Aktuelle Session abrufen",
        description:
          "Liest die Principal-Daten direkt aus dem uebergebenen Bearer-Token (Rolle, eventId, optional user).",
        security: [{ bearerAuth: [] }],
        response: {
          200: AuthMeResponseSchema,
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => authStore.getPrincipalFromClaims(request.auth)
  );
}

