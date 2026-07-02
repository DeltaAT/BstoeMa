import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../app";

function getPath(spec: { paths?: Record<string, unknown> }, path: string) {
  const value = spec.paths?.[path];
  assert.ok(value, `Expected Swagger path ${path} to exist`);
  return value as Record<string, unknown>;
}

test("swagger spec includes the documented core routes and critical responses", { concurrency: false }, async () => {
  const app = await buildApp();
  await app.ready();
  const specRaw = app.swagger() as {
    openapi?: string;
    paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    tags?: Array<{ name: string }>;
    openapiObject?: {
      openapi?: string;
      paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
      tags?: Array<{ name: string }>;
    };
  };
  const spec = specRaw.openapiObject ?? specRaw;

  assert.ok(spec, "Expected OpenAPI object from Swagger");

  assert.ok(spec.openapi?.startsWith("3."), "Expected OpenAPI 3 spec");

  const tagNames = new Set((spec.tags ?? []).map((tag) => tag.name));
  for (const expectedTag of ["admin-events", "auth", "config", "menu", "orders", "printers", "stock", "tables", "users"]) {
    assert.ok(tagNames.has(expectedTag), `Expected tag ${expectedTag} in Swagger document`);
  }

  getPath(spec, "/admin/events");
  getPath(spec, "/admin/events/active");
  getPath(spec, "/auth/master/login");
  getPath(spec, "/auth/admin/login");
  getPath(spec, "/auth/login");
  getPath(spec, "/orders");
  getPath(spec, "/orders/{orderId}");
  getPath(spec, "/tables");
  getPath(spec, "/tables/{tableId}/qr");
  getPath(spec, "/tables/qr.pdf");

  const authLoginResponses = spec.paths?.["/auth/login"]?.post?.responses ?? {};
  assert.ok("423" in authLoginResponses, "Expected USER_LOCKED response in auth login Swagger docs");

  const ordersResponses = spec.paths?.["/orders"]?.get?.responses ?? {};
  assert.ok("423" in ordersResponses, "Expected USER_LOCKED response in orders list Swagger docs");
  const orderCreateResponses = spec.paths?.["/orders"]?.post?.responses ?? {};
  assert.ok("423" in orderCreateResponses, "Expected USER_LOCKED response in order create Swagger docs");
  const orderGetResponses = spec.paths?.["/orders/{orderId}"]?.get?.responses ?? {};
  assert.ok("423" in orderGetResponses, "Expected USER_LOCKED response in order get Swagger docs");

  const qrPdfResponses = spec.paths?.["/tables/qr.pdf"]?.post?.responses ?? {};
  const qrPdf200 = qrPdfResponses["200"] as { content?: Record<string, { schema?: { format?: string } }> } | undefined;
  assert.ok(qrPdf200?.content?.["application/pdf"], "Expected PDF content type in QR PDF Swagger docs");
  assert.equal(qrPdf200?.content?.["application/pdf"]?.schema?.format, "binary");

  const qrSvgResponses = spec.paths?.["/tables/{tableId}/qr"]?.get?.responses ?? {};
  assert.ok(qrSvgResponses["200"], "Expected QR SVG 200 response in Swagger docs");

  await app.close();
});

