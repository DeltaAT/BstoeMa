import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
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
import { registerAdminEventRoutes } from "./routes/admin-events";
import { registerAuthRoutes } from "./routes/auth";
import { registerConfigRoutes } from "./routes/config";
import { registerMenuRoutes } from "./routes/menu";
import { registerOrderRoutes } from "./routes/orders";
import { registerOpsRoutes } from "./routes/operations";
import { registerPrinterRoutes } from "./routes/printers";
import { registerStockRoutes } from "./routes/stock";
import { registerTableRoutes } from "./routes/tables";
import { registerUserRoutes } from "./routes/users";

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

export async function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

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
        { name: "auth", description: "Authentication endpoints" },
        { name: "config", description: "Event configuration endpoints" },
        { name: "menu", description: "Menu categories and items" },
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

  // setNotFoundHandler: OPTIONS preflights never match a route, so they land
  // here. Return 204 with CORS headers so the browser allows the real request.
  app.setNotFoundHandler(async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: `Route not found: ${request.method} ${request.url}` },
    });
  });

  registerErrorHandler(app);
  registerJwtAuthGuard(app);
  registerActiveEventGuard(app);
  registerOpsRoutes(app);
  registerAdminEventRoutes(app);
  registerAuthRoutes(app);
  registerConfigRoutes(app);
  registerPrinterRoutes(app);
  registerUserRoutes(app);
  registerMenuRoutes(app);
  registerOrderRoutes(app);
  registerStockRoutes(app);
  registerTableRoutes(app);

  return app;
}

