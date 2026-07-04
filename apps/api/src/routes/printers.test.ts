import assert from "node:assert/strict";
import Database from "better-sqlite3";
import net from "node:net";
import test from "node:test";
import { buildApp } from "../app";
import { eventStore, printerStore } from "../domain/state";
import { setupEventTestUtils } from "../test-utils/event-test-utils";

const { createTestEvent, createEventPrefix, createAppFixture, createAuthFixture } = setupEventTestUtils(
  test,
  eventStore
);

async function createFakeThermalPrinterServer(port = 0) {
  let receivedBytes = 0;
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.on("data", (chunk) => {
      receivedBytes += chunk.length;
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to acquire fake printer address");
  }

  return {
    port: address.port,
    getConnections: () => connections,
    getReceivedBytes: () => receivedBytes,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function reservePortAndClose() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to reserve local TCP port");
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return address.port;
}

function seedMenuCategoryWithPrinter(dbFilePath: string, printerId: number) {
  const db = new Database(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS MenuCategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      isLocked INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 0,
      printer_id INTEGER,
      orderDisplay_id INTEGER
    );
  `);

  db.prepare(
    "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, ?, NULL)"
  ).run("Kitchen", "", 0, 0, printerId);
  db.close();
}

// Seeds a minimal but complete order that routes to `printerId`, returning the
// new order id. Mirrors the schema the printer store reads in printOrder.
function seedPrintableOrder(dbFilePath: string, printerId: number): number {
  const db = new Database(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS MenuCategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      isLocked INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 0,
      printer_id INTEGER,
      orderDisplay_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS MenuItems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      menuCategory_id INTEGER NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS Orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      table_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS OrderItems (
      order_id INTEGER NOT NULL,
      menuItem_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      specialRequests TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (order_id, menuItem_id)
    );
    CREATE TABLE IF NOT EXISTS Tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
  `);

  const categoryId = Number(
    db
      .prepare(
        "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, '', 0, 0, ?, NULL)"
      )
      .run("Kitchen", printerId).lastInsertRowid
  );
  const menuItemId = Number(
    db
      .prepare("INSERT INTO MenuItems (name, menuCategory_id, weight) VALUES (?, ?, 0)")
      .run("Pommes", categoryId).lastInsertRowid
  );
  const orderId = Number(
    db
      .prepare("INSERT INTO Orders (timestamp, table_id, user_id) VALUES (?, 1, 1)")
      .run(new Date().toISOString()).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO OrderItems (order_id, menuItem_id, quantity, specialRequests) VALUES (?, ?, ?, '')"
  ).run(orderId, menuItemId, 2);
  db.close();

  return orderId;
}

test("printers endpoints reject unauthorized requests", { concurrency: false }, async () => {
  const app = await createAppFixture(buildApp);
  const response = await app.inject({
    method: "GET",
    url: "/printers",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHORIZED");
});

test("printers endpoints require active event", { concurrency: false }, async () => {
  const created = createTestEvent({
    eventName: createEventPrefix("printers-no-active"),
    eventPasscode: "printers-pass",
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(created.id);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const adminToken = await auth.loginAdmin({
    eventId: created.id,
    username: "chef",
    password: "secret123",
  });

  eventStore.deactivateEvent(created.id);

  const response = await app.inject({
    method: "GET",
    url: "/printers",
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "NO_ACTIVE_EVENT");
});

test("waiter session cannot access printer admin endpoints", { concurrency: false }, async () => {
  const eventPasscode = "printers-waiter-pass";
  const created = createTestEvent({
    eventName: createEventPrefix("printers-forbidden"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(created.id);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterToken = (await auth.loginWaiter({ username: "waiter-printer", eventPasscode })).accessToken;

  const response = await app.inject({
    method: "POST",
    url: "/printers",
    headers: { authorization: `Bearer ${waiterToken}` },
    payload: { name: "Kitchen", ipAddress: "127.0.0.1", connectionDetails: "9100" },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "FORBIDDEN");
});

test("admin can create/list printers and send test print", { concurrency: false }, async () => {
  const fakePrinter = await createFakeThermalPrinterServer();
  const adminPassword = "secret123";
  const created = createTestEvent({
    eventName: createEventPrefix("printers-crud"),
    eventPasscode: "printers-crud-pass",
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

  try {
    const createPrinter = await app.inject({
      method: "POST",
      url: "/printers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "Kitchen",
        ipAddress: "127.0.0.1",
        connectionDetails: String(fakePrinter.port),
      },
    });
    assert.equal(createPrinter.statusCode, 201);
    const printerId = createPrinter.json().id as number;

    const listPrinters = await app.inject({
      method: "GET",
      url: "/printers",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listPrinters.statusCode, 200);
    assert.deepEqual(
      (listPrinters.json() as { printers: Array<{ name: string }> }).printers.map(
        (printer) => printer.name
      ),
      ["Kitchen"]
    );

    const getPrinter = await app.inject({
      method: "GET",
      url: `/printers/${printerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getPrinter.statusCode, 200);
    assert.equal(getPrinter.json().name, "Kitchen");

    const patchPrinter = await app.inject({
      method: "PATCH",
      url: `/printers/${printerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "Kitchen Updated",
      },
    });
    assert.equal(patchPrinter.statusCode, 200);
    assert.equal(patchPrinter.json().name, "Kitchen Updated");

    seedMenuCategoryWithPrinter(created.dbFilePath, printerId);

    const deleteInUse = await app.inject({
      method: "DELETE",
      url: `/printers/${printerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteInUse.statusCode, 409);
    assert.equal(deleteInUse.json().error.code, "PRINTER_IN_USE");

    const createDeleteCandidate = await app.inject({
      method: "POST",
      url: "/printers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "Bar",
        ipAddress: "127.0.0.1",
        connectionDetails: "9100",
      },
    });
    assert.equal(createDeleteCandidate.statusCode, 201);
    const deleteCandidateId = createDeleteCandidate.json().id as number;

    const deletePrinter = await app.inject({
      method: "DELETE",
      url: `/printers/${deleteCandidateId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deletePrinter.statusCode, 204);

    const getMissingPrinter = await app.inject({
      method: "GET",
      url: "/printers/99999999",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getMissingPrinter.statusCode, 404);
    assert.equal(getMissingPrinter.json().error.code, "PRINTER_NOT_FOUND");

    const testPrint = await app.inject({
      method: "POST",
      url: `/printers/${printerId}/test-print`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(testPrint.statusCode, 200);
    assert.equal(testPrint.json().ok, true);

    assert.ok(fakePrinter.getConnections() > 0);
  } finally {
    await fakePrinter.close();
  }
});

test("test-print returns understandable connection errors", { concurrency: false }, async () => {
  const closedPort = await reservePortAndClose();
  const adminPassword = "secret123";
  const created = createTestEvent({
    eventName: createEventPrefix("printers-connection-error"),
    eventPasscode: "printers-connection-error-pass",
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

  const createPrinter = await app.inject({
    method: "POST",
    url: "/printers",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      name: "Offline Printer",
      ipAddress: "127.0.0.1",
      connectionDetails: String(closedPort),
    },
  });
  assert.equal(createPrinter.statusCode, 201);
  const printerId = createPrinter.json().id as number;

  const response = await app.inject({
    method: "POST",
    url: `/printers/${printerId}/test-print`,
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.statusCode, 409);
  const body = response.json() as {
    error: { code: string; message: string; details?: { target?: string; hint?: string } };
  };
  assert.ok(
    ["PRINTER_CONNECTION_FAILED", "PRINTER_CONNECTION_REFUSED"].includes(body.error.code),
    `Unexpected error code: ${body.error.code}`
  );
  assert.match(body.error.message, /Printer/);
  assert.match(body.error.details?.target ?? "", /127\.0\.0\.1:/);
  assert.ok((body.error.details?.hint ?? "").length > 0);
});

test("offline printer queues the bon and the worker prints it on reconnect", { concurrency: false }, async () => {
  const closedPort = await reservePortAndClose();
  const created = createTestEvent({
    eventName: createEventPrefix("printer-queue"),
    eventPasscode: "printer-queue-pass",
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(created.id);

  const printer = printerStore.createPrinter({
    name: "Kitchen",
    ipAddress: "127.0.0.1",
    connectionDetails: String(closedPort),
  });
  const orderId = seedPrintableOrder(created.dbFilePath, printer.id);

  // Printer is offline → the bon must be queued, not lost.
  const firstRun = await printerStore.printOrder(orderId);
  const queuedResult = firstRun.results.find((r) => r.printerId === printer.id);
  assert.equal(queuedResult?.status, "queued");

  const pendingBefore = (() => {
    const db = new Database(created.dbFilePath);
    try {
      return (db.prepare("SELECT COUNT(*) as count FROM PrintQueue").get() as { count: number })
        .count;
    } finally {
      db.close();
    }
  })();
  assert.equal(pendingBefore, 1);

  // Printer comes back online on the same address → worker drains the queue.
  const fakePrinter = await createFakeThermalPrinterServer(closedPort);
  try {
    const drain = await printerStore.processPrintQueue();
    assert.equal(drain.printed, 1);
    assert.equal(drain.remaining, 0);
    assert.ok(
      fakePrinter.getConnections() > 0,
      "expected the queued bon to reach the printer on reconnect"
    );
  } finally {
    await fakePrinter.close();
  }

  // Draining again is a no-op — the delivered bon is gone from the queue.
  const secondDrain = await printerStore.processPrintQueue();
  assert.equal(secondDrain.printed, 0);
  assert.equal(secondDrain.remaining, 0);
});

test("re-printing an offline order does not stack duplicate queue entries", { concurrency: false }, async () => {
  const closedPort = await reservePortAndClose();
  const created = createTestEvent({
    eventName: createEventPrefix("printer-queue-dedupe"),
    eventPasscode: "printer-queue-dedupe-pass",
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(created.id);

  const printer = printerStore.createPrinter({
    name: "Kitchen",
    ipAddress: "127.0.0.1",
    connectionDetails: String(closedPort),
  });
  const orderId = seedPrintableOrder(created.dbFilePath, printer.id);

  await printerStore.printOrder(orderId);
  await printerStore.printOrder(orderId);

  const db = new Database(created.dbFilePath);
  try {
    const row = db
      .prepare("SELECT COUNT(*) as count, MAX(attempts) as attempts FROM PrintQueue WHERE orderId = ?")
      .get(orderId) as { count: number; attempts: number };
    assert.equal(row.count, 1);
    assert.equal(row.attempts, 2);
  } finally {
    db.close();
  }
});

