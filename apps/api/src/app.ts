import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { registerActiveEventGuard } from "./plugins/active-event-guard";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerJwtAuthGuard } from "./plugins/jwt-auth-guard";
import { createLogBufferStream, logBuffer } from "./plugins/log-buffer";
import { registerLogRoutes } from "./routes/logs";
import { registerAdminEventRoutes } from "./routes/admin-events";
import { registerAnnouncementRoutes } from "./routes/announcements";
import { registerAuthRoutes } from "./routes/auth";
import { registerConfigRoutes } from "./routes/config";
import { registerMenuRoutes } from "./routes/menu";
import { registerOrderRoutes } from "./routes/orders";
import { registerOrderDisplayRoutes } from "./routes/order-displays";
import { registerOpsRoutes } from "./routes/operations";
import { registerPrinterRoutes } from "./routes/printers";
import { registerStockRoutes } from "./routes/stock";
import { registerTableRoutes } from "./routes/tables";
import { registerUserRoutes } from "./routes/users";

/**
 * Resolves the directory holding the waiter-web `dist/` (its `index.html` and
 * static assets). Resolution order:
 *   1. `WAITER_DIST_PATH` env var (absolute or relative to cwd)
 *   2. `../../waiter-web/dist` relative to this file (monorepo dev/build)
 * Returns `null` if no candidate contains `index.html`.
 */
function resolveWaiterDist(): string | null {
  const candidates: string[] = [];

  const envPath = process.env.WAITER_DIST_PATH;
  if (envPath) {
    candidates.push(isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath));
  }

  // When compiled, this file lives in apps/api/dist/; when running via tsx it
  // lives in apps/api/src/. Both resolve up to the monorepo and across.
  const here = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(here, "../../waiter-web/dist"));
  candidates.push(resolve(here, "../../../waiter-web/dist"));

  for (const c of candidates) {
    try {
      if (existsSync(join(c, "index.html")) && statSync(c).isDirectory()) {
        return c;
      }
    } catch {
      // ignore and try next
    }
  }
  return null;
}

function patchSwaggerObject(swaggerObject: Record<string, any>) {
  const tableSvgResponse = swaggerObject.paths?.["/tables/{tableId}/qr"]?.get?.responses?.["200"];
  if (tableSvgResponse) {
    tableSvgResponse.content = {
      "image/svg+xml": {
        schema: {
          type: "string",
          example: '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
        },
      },
    };
  }

  const tablesPdfResponse = swaggerObject.paths?.["/tables/qr.pdf"]?.get?.responses?.["200"];
  if (tablesPdfResponse) {
    tablesPdfResponse.content = {
      "application/pdf": {
        schema: {
          type: "string",
          format: "binary",
        },
      },
    };
  }

  return swaggerObject;
}

import type { FastifyServerFactory } from "fastify";

interface BuildAppOptions {
  serverFactory?: FastifyServerFactory;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      stream: createLogBufferStream(logBuffer),
    },
    ...(options.serverFactory ? { serverFactory: options.serverFactory } : {}),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || "dev-jwt-secret-change-me",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Serva API",
        description: "Runtime-validated contracts shared across frontend and backend",
        version: "1.0.0",
      },
      tags: [
        { name: "admin-events", description: "Admin event lifecycle endpoints" },
        { name: "announcements", description: "Admin-to-waiter announcements" },
        { name: "auth", description: "Authentication endpoints" },
        { name: "config", description: "Event configuration endpoints" },
        { name: "menu", description: "Menu categories and items" },
        { name: "order-displays", description: "Kitchen/bar display routing targets" },
        { name: "orders", description: "Order submission and order history" },
        { name: "printers", description: "Printer management and test-print endpoints" },
        { name: "stock", description: "Stock item management" },
        { name: "tables", description: "Table management endpoints" },
        { name: "users", description: "Admin waiter user management endpoints" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Token",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  const swaggerApp = app as typeof app & { swagger: (...args: Array<unknown>) => unknown };
  const originalSwagger = swaggerApp.swagger.bind(swaggerApp);
  swaggerApp.swagger = ((...args: Array<unknown>) => {
    const result = originalSwagger(...args) as Record<string, any>;
    patchSwaggerObject(result);
    return result;
  }) as typeof swaggerApp.swagger;

  await app.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  // onSend: inject headers on every matched-route response (200, 401, 4xx…)
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return payload;
  });

  // setNotFoundHandler:
  //  - OPTIONS preflights never match a route, so they land here. Return 204
  //    with CORS headers so the browser allows the real request.
  //  - GETs under `/waiter` that didn't resolve to a static file are SPA
  //    deep-links (e.g. `/waiter/menu`) — serve `index.html` so the client
  //    router can take over.
  app.setNotFoundHandler(async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
    // request.url includes the query string, so match on the pathname only —
    // otherwise `/waiter?passcode=…` (the QR login deep-link) drops through to 404.
    const path = request.url.split("?", 1)[0];
    if (
      request.method === "GET" &&
      waiterDist &&
      (path === "/waiter" || path.startsWith("/waiter/"))
    ) {
      reply.type("text/html");
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: `Route not found: ${request.method} ${request.url}` },
    });
  });

  // ── Static-serve waiter PWA ──────────────────────────────────────────────
  // The waiter-web build output is mounted at `/waiter/` so phones can load
  // it from the same origin as the API (no CORS, no second port). The path
  // is overridable via `WAITER_DIST_PATH` for the Tauri sidecar bundle.
  // SPA fallback (deep-link reloads → index.html) is handled below in the
  // global notFoundHandler.
  const waiterDist = resolveWaiterDist();
  if (waiterDist) {
    await app.register(fastifyStatic, {
      root: waiterDist,
      prefix: "/waiter/",
    });
  } else {
    app.log.warn(
      "Waiter PWA dist not found — set WAITER_DIST_PATH or run `pnpm --filter waiter-web build`"
    );
  }

  registerErrorHandler(app);
  registerJwtAuthGuard(app);
  registerActiveEventGuard(app);
  registerOpsRoutes(app);
  registerAdminEventRoutes(app);
  registerAnnouncementRoutes(app);
  registerAuthRoutes(app);
  registerConfigRoutes(app);
  registerPrinterRoutes(app);
  registerUserRoutes(app);
  registerMenuRoutes(app);
  registerOrderRoutes(app);
  registerOrderDisplayRoutes(app);
  registerStockRoutes(app);
  registerTableRoutes(app);
  registerLogRoutes(app, logBuffer);

  return app;
}

