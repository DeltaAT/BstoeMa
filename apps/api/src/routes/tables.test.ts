import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { PDFDocument } from "pdf-lib";
import { buildApp } from "../app";
import { eventStore } from "../domain/state";
import { setupEventTestUtils } from "../test-utils/event-test-utils";

const { createTestEvent, createEventPrefix, createAppFixture, createAuthFixture } = setupEventTestUtils(
  test,
  eventStore
);

function seedTables(
  dbFilePath: string,
  tables: Array<{ name: string; weight: number; isLocked?: boolean }>
) {
  const db = new Database(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS Tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      isLocked INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS Tables_name_key ON Tables(name);
  `);

  const insert = db.prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)");
  for (const table of tables) {
    insert.run(table.name, table.weight, table.isLocked ? 1 : 0);
  }

  db.close();
}

test("tables endpoint rejects unauthorized requests", { concurrency: false }, async () => {
  const app = await createAppFixture(buildApp);

  const response = await app.inject({
    method: "GET",
    url: "/tables",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHORIZED");
});

test("waiter session can access GET /tables", { concurrency: false }, async () => {
  const eventPasscode = "tables-pass";
  const created = createTestEvent({
    eventName: createEventPrefix("tables-waiter"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(created.id);
  seedTables(created.dbFilePath, [{ name: "A1", weight: 1 }]);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterToken = (await auth.loginWaiter({ username: "waiter", eventPasscode })).accessToken;

  const response = await app.inject({
    method: "GET",
    url: "/tables",
    headers: { authorization: `Bearer ${waiterToken}` },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { tables: Array<{ name: string }> };
  assert.deepEqual(body.tables.map((table) => table.name), ["A1"]);
});

test("tables endpoint requires active event", { concurrency: false }, async () => {
  const eventPasscode = "tables-no-active";
  const created = createTestEvent({
    eventName: createEventPrefix("tables-no-active"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(created.id);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterToken = (await auth.loginWaiter({ username: "waiter", eventPasscode })).accessToken;

  eventStore.deactivateEvent(created.id);

  const response = await app.inject({
    method: "GET",
    url: "/tables",
    headers: { authorization: `Bearer ${waiterToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "NO_ACTIVE_EVENT");
});

test("GET /tables returns only active event and sorts by weight", { concurrency: false }, async () => {
  const eventPasscode = "tables-sorting";
  const activeEvent = createTestEvent({
    eventName: createEventPrefix("tables-active"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(activeEvent.id);
  seedTables(activeEvent.dbFilePath, [
    { name: "B2", weight: 2 },
    { name: "A1", weight: 1 },
  ]);

  const inactiveEvent = createTestEvent({
    eventName: createEventPrefix("tables-inactive"),
    eventPasscode: "inactive-pass",
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  seedTables(inactiveEvent.dbFilePath, [{ name: "ZZ1", weight: 0 }]);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterToken = (await auth.loginWaiter({ username: "sort-waiter", eventPasscode })).accessToken;

  const response = await app.inject({
    method: "GET",
    url: "/tables?sort=weight,name",
    headers: { authorization: `Bearer ${waiterToken}` },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { tables: Array<{ name: string }> };
  assert.deepEqual(body.tables.map((table) => table.name), ["A1", "B2"]);
});

test("admin CRUD and bulk table endpoints work", { concurrency: false }, async () => {
  const adminPassword = "secret123";
  const created = createTestEvent({
    eventName: createEventPrefix("tables-crud"),
    eventPasscode: "tables-crud-pass",
    adminUsername: "chef",
    adminPassword,
  });
  eventStore.activateEvent(created.id);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const adminToken = await auth.loginAdmin({
    eventId: created.id,
    username: "chef",
    password: adminPassword,
  });

  const createSingle = await app.inject({
    method: "POST",
    url: "/tables",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "A1", weight: 10 },
  });
  assert.equal(createSingle.statusCode, 201);
  const singleTableId = createSingle.json().id as number;

  const duplicateSingle = await app.inject({
    method: "POST",
    url: "/tables",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "A1" },
  });
  assert.equal(duplicateSingle.statusCode, 409);
  assert.equal(duplicateSingle.json().error.code, "TABLE_ALREADY_EXISTS");

  const bulkCreate = await app.inject({
    method: "POST",
    url: "/tables/bulk",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { rows: ["B"], from: 1, to: 3, lockNew: true },
  });
  assert.equal(bulkCreate.statusCode, 201);
  const bulkBody = bulkCreate.json() as { tables: Array<{ name: string; isLocked: boolean }> };
  assert.equal(bulkBody.tables.length, 3);
  assert.deepEqual(
    bulkBody.tables.map((table) => table.name),
    ["B1", "B2", "B3"]
  );
  assert.equal(bulkBody.tables.every((table) => table.isLocked), true);

  const patchSingle = await app.inject({
    method: "PATCH",
    url: `/tables/${singleTableId}`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "A1-renamed", isLocked: true, weight: 1 },
  });
  assert.equal(patchSingle.statusCode, 200);
  assert.equal(patchSingle.json().name, "A1-renamed");
  assert.equal(patchSingle.json().isLocked, true);

  const qrSingle = await app.inject({
    method: "GET",
    url: `/tables/${singleTableId}/qr`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(qrSingle.statusCode, 200);
  assert.match(qrSingle.headers["content-type"] ?? "", /image\/svg\+xml/);
  assert.match(qrSingle.body, /<svg/);

  const qrPdf = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {},
  });
  assert.equal(qrPdf.statusCode, 200);
  assert.match(qrPdf.headers["content-type"] ?? "", /application\/pdf/);
  assert.equal(qrPdf.body.startsWith("%PDF-"), true);
  assert.match(qrPdf.headers["content-disposition"] ?? "", /tables-qr\.pdf/);

  const qrPdfBytes =
    (qrPdf as unknown as { rawPayload?: Buffer }).rawPayload ?? Buffer.from(qrPdf.body, "latin1");
  const qrPdfDoc = await PDFDocument.load(qrPdfBytes);
  assert.equal(qrPdfDoc.getPages().length, 2, "Expected default 2-up QR layout");
  const defaultPage = qrPdfDoc.getPages()[0];
  assert.equal(
    defaultPage.getWidth() < defaultPage.getHeight(),
    true,
    "Expected default 2-up layout to stay portrait"
  );

  const qrPdfSingleLayout = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { layout: "single" },
  });
  assert.equal(qrPdfSingleLayout.statusCode, 200);
  const qrPdfSingleBytes =
    (qrPdfSingleLayout as unknown as { rawPayload?: Buffer }).rawPayload ??
    Buffer.from(qrPdfSingleLayout.body, "latin1");
  const qrPdfSingleDoc = await PDFDocument.load(qrPdfSingleBytes);
  assert.equal(qrPdfSingleDoc.getPages().length, 4, "Expected single layout to render one table per page");
  const singlePage = qrPdfSingleDoc.getPages()[0];
  assert.equal(
    singlePage.getWidth() > singlePage.getHeight(),
    true,
    "Expected single layout to be landscape"
  );

  const qrPdfSelected = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { layout: "single", tableIds: [singleTableId] },
  });
  assert.equal(qrPdfSelected.statusCode, 200);
  const qrPdfSelectedBytes =
    (qrPdfSelected as unknown as { rawPayload?: Buffer }).rawPayload ??
    Buffer.from(qrPdfSelected.body, "latin1");
  const qrPdfSelectedDoc = await PDFDocument.load(qrPdfSelectedBytes);
  assert.equal(
    qrPdfSelectedDoc.getPages().length,
    1,
    "Expected only the single selected table to be exported"
  );

  // A branding footer (BstöMa mode) must not break the export.
  const qrPdfBranded = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { branding: { mode: "bstoema" } },
  });
  assert.equal(qrPdfBranded.statusCode, 200);
  const qrPdfBrandedBytes =
    (qrPdfBranded as unknown as { rawPayload?: Buffer }).rawPayload ??
    Buffer.from(qrPdfBranded.body, "latin1");
  assert.equal((await PDFDocument.load(qrPdfBrandedBytes)).getPages().length, 2);

  // Custom branding with an uploaded 1x1 PNG logo + label must also render.
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const qrPdfCustom = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { branding: { mode: "custom", customLabel: "Mein Lokal", customLogo: tinyPng } },
  });
  assert.equal(qrPdfCustom.statusCode, 200);
  assert.equal(qrPdfCustom.body.startsWith("%PDF-"), true);

  // A malformed logo data URL is rejected by validation.
  const qrPdfBadLogo = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { branding: { mode: "custom", customLogo: "not-a-data-url" } },
  });
  assert.equal(qrPdfBadLogo.statusCode, 400, "Expected malformed customLogo to be rejected");

  const qrPdfBadIds = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { tableIds: ["abc"] },
  });
  assert.equal(qrPdfBadIds.statusCode, 400, "Expected non-numeric tableIds to be rejected");

  // Streaming export: NDJSON progress lines followed by a base64 PDF.
  const qrPdfStream = await app.inject({
    method: "POST",
    url: "/tables/qr.pdf/stream",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { layout: "single" },
  });
  assert.equal(qrPdfStream.statusCode, 200);
  assert.match(qrPdfStream.headers["content-type"] ?? "", /application\/x-ndjson/);
  const streamEvents = qrPdfStream.body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; done?: number; total?: number; pdfBase64?: string });
  const progressEvents = streamEvents.filter((event) => event.type === "progress");
  assert.ok(progressEvents.length >= 2, "Expected an initial and per-table progress event");
  assert.equal(progressEvents[0].done, 0, "Expected the first progress event to report 0 done");
  const lastProgress = progressEvents[progressEvents.length - 1];
  assert.equal(lastProgress.done, lastProgress.total, "Expected progress to reach 100%");
  assert.ok(lastProgress.total && lastProgress.total > 0, "Expected a non-zero table total");
  const doneEvent = streamEvents.find((event) => event.type === "done");
  assert.ok(doneEvent?.pdfBase64, "Expected a terminal done event carrying the PDF");
  const streamedPdf = Buffer.from(doneEvent!.pdfBase64!, "base64");
  assert.equal(streamedPdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(
    (await PDFDocument.load(streamedPdf)).getPages().length,
    lastProgress.total,
    "Expected one page per table in the single layout stream export"
  );

  const waiterToken = (await auth.loginWaiter({
    username: "crud-waiter",
    eventPasscode: "tables-crud-pass",
  })).accessToken;
  const waiterCreate = await app.inject({
    method: "POST",
    url: "/tables",
    headers: { authorization: `Bearer ${waiterToken}` },
    payload: { name: "C1" },
  });
  assert.equal(waiterCreate.statusCode, 403);

});

test("bulk-created tables land at the beginning in request order across repeated adds", { concurrency: false }, async () => {
  const adminPassword = "secret123";
  const created = createTestEvent({
    eventName: createEventPrefix("tables-bulk-order"),
    eventPasscode: "tables-bulk-order-pass",
    adminUsername: "chef",
    adminPassword,
  });
  eventStore.activateEvent(created.id);

  // Pre-existing tables, spaced like the admin UI's reorder scheme ((i+1)*10).
  seedTables(created.dbFilePath, [
    { name: "Existing1", weight: 10 },
    { name: "Existing2", weight: 20 },
  ]);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const adminToken = await auth.loginAdmin({
    eventId: created.id,
    username: "chef",
    password: adminPassword,
  });

  const listNames = async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tables?sort=weight,name",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    return (res.json() as { tables: Array<{ name: string }> }).tables.map((t) => t.name);
  };

  // First bulk add → the batch must appear as a contiguous block at the top,
  // in the requested numeric order, ahead of the existing tables.
  const firstBulk = await app.inject({
    method: "POST",
    url: "/tables/bulk",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { rows: ["A"], from: 1, to: 3 },
  });
  assert.equal(firstBulk.statusCode, 201);
  assert.deepEqual(
    (firstBulk.json() as { tables: Array<{ name: string }> }).tables.map((t) => t.name),
    ["A1", "A2", "A3"]
  );
  assert.deepEqual(await listNames(), ["A1", "A2", "A3", "Existing1", "Existing2"]);

  // Second bulk add stacks cleanly above the first — newest batch on top, still
  // in request order, with no interleaving (issue #138).
  const secondBulk = await app.inject({
    method: "POST",
    url: "/tables/bulk",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { rows: ["B"], from: 1, to: 2 },
  });
  assert.equal(secondBulk.statusCode, 201);
  assert.deepEqual(await listNames(), [
    "B1",
    "B2",
    "A1",
    "A2",
    "A3",
    "Existing1",
    "Existing2",
  ]);
});

