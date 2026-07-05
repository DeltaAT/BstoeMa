import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../domain/api-error";
import { eventStore } from "../domain/state";

const AuthClaimsSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("master") }).passthrough(),
  z
    .object({
      role: z.literal("admin"),
      eventId: z.number().int().positive(),
      username: z.string().trim().min(1),
    })
    .passthrough(),
  z
    .object({
      role: z.literal("waiter"),
      eventId: z.number().int().positive(),
      username: z.string().trim().min(1),
    })
    .passthrough(),
]);

export function registerJwtAuthGuard(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    const routeConfig = request.routeOptions.config;
    // allowedRoles implies auth: routes declaring only allowedRoles (without
    // requiresAuth) would otherwise skip token validation entirely and either
    // leak through to the handler unauthenticated or surface as 409
    // NO_ACTIVE_EVENT instead of 401.
    const requiresAuth = Boolean(
      routeConfig?.requiresAuth || routeConfig?.requiresRole || routeConfig?.allowedRoles
    );
    if (!requiresAuth) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing bearer token");
    }

    try {
      const payload = await request.jwtVerify();
      request.auth = AuthClaimsSchema.parse(payload);
    } catch {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid access token");
    }

    const allowedRoles = routeConfig?.allowedRoles as Array<"master" | "admin" | "waiter"> | undefined;
    const minRole = routeConfig?.requiresRole;
    if (!minRole && !allowedRoles) {
      return;
    }

    if (allowedRoles) {
      if (!allowedRoles.includes(request.auth.role)) {
        throw new ApiError(403, "FORBIDDEN", `${allowedRoles.join(" or ")} role required`);
      }
    } else if (request.auth.role !== minRole) {
      throw new ApiError(403, "FORBIDDEN", `${minRole} role required`);
    }

    if (routeConfig?.requiresActiveEvent && request.auth.role !== "master") {
      const activeEvent = eventStore.getActiveEvent();
      if (activeEvent && request.auth.eventId !== activeEvent.id) {
        throw new ApiError(403, "FORBIDDEN", "Token is bound to a different event");
      }
    }
  });
}

