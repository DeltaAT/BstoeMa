import {
  ApiErrorEnvelopeSchema,
  UserCreateRequest,
  UserCreateRequestSchema,
  UserCreateResponseSchema,
  UserGetResponseSchema,
  UserParams,
  UserParamsSchema,
  UsersQuery,
  UsersQuerySchema,
  UsersResponseSchema,
  UserUpdateRequest,
  UserUpdateRequestSchema,
  UserUpdateResponseSchema,
} from "@bstoema/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { userStore } from "../domain/state";

export function registerUserRoutes(app: FastifyInstance) {
  app.get<{ Querystring: UsersQuery }>(
    "/users",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["users"],
        operationId: "usersList",
        summary: "Waiter-User auflisten",
        description:
          "Listet User des aktiven Events. Query-Beispiele: ?locked=true, ?search=ann",
        security: [{ bearerAuth: [] }],
        querystring: UsersQuerySchema,
        response: {
          200: UsersResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return {
        users: userStore.listUsers({
          locked: request.query.locked,
          search: request.query.search,
        }),
      };
    }
  );

  app.post<{ Body: UserCreateRequest }>(
    "/users",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["users"],
        operationId: "usersCreate",
        summary: "Waiter-User erstellen",
        description:
          "Erstellt einen neuen Waiter-User im aktiven Event. Beispiel-Body: { username: 'anna', isLocked: false }",
        security: [{ bearerAuth: [] }],
        body: UserCreateRequestSchema,
        response: {
          201: UserCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = userStore.createUser(request.body);
      return reply.status(201).send(created);
    }
  );

  app.get<{ Params: UserParams }>(
    "/users/:userId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["users"],
        operationId: "usersGetById",
        summary: "Waiter-User per ID abrufen",
        description: "Liefert einen einzelnen User aus dem aktiven Event.",
        security: [{ bearerAuth: [] }],
        params: UserParamsSchema,
        response: {
          200: UserGetResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => userStore.getUser(request.params.userId)
  );

  app.patch<{ Params: UserParams; Body: UserUpdateRequest }>(
    "/users/:userId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["users"],
        operationId: "usersUpdate",
        summary: "Waiter-User aktualisieren",
        description:
          "Aktualisiert einzelne Felder eines Users, z. B. Sperrstatus oder Username.",
        security: [{ bearerAuth: [] }],
        params: UserParamsSchema,
        body: UserUpdateRequestSchema,
        response: {
          200: UserUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => userStore.updateUser(request.params.userId, request.body)
  );

  app.delete<{ Params: UserParams }>(
    "/users/:userId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["users"],
        operationId: "usersDelete",
        summary: "Waiter-User loeschen",
        description: "Loescht einen User aus dem aktiven Event.",
        security: [{ bearerAuth: [] }],
        params: UserParamsSchema,
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
      userStore.deleteUser(request.params.userId);
      return reply.status(204).send();
    }
  );
}

