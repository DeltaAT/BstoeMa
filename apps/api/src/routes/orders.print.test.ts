import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import Database from "better-sqlite3";
import { buildApp } from "../app";
import { eventStore } from "../domain/state";
import { setupEventTestUtils } from "../test-utils/event-test-utils";

const {
  createEventPrefix,
  createActiveDbFixture,
  createAppFixture,
  createAuthFixture,
} = setupEventTestUtils(test, eventStore);

// Tiny TCP echo to stand in for a thermal printer. Captures the byte count so
// tests can assert that something was actually sent.
async function startFakePrinter() {
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
    server.listen(0, "127.0.0.1", () => {
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
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function seedSchemaAndData(
  dbFilePath: string,
  options: { printerPort?: number; assignPrinter: boolean },
) {
  const db = new Database(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS Tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      isLocked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS Printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ipAddress TEXT NOT NULL,
      connectionDetails TEXT NOT NULL DEFAULT ''
    );
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
      description TEXT NOT NULL DEFAULT '',
      weight INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      isLocked INTEGER NOT NULL DEFAULT 0,
      menuCategory_id INTEGER NOT NULL
    );
  `);

  const tableId = Number(
    db
      .prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)")
      .run("T1", 0, 0).lastInsertRowid,
  );

  let printerId: number | null = null;
  if (options.assignPrinter && options.printerPort !== undefined) {
    printerId = Number(
      db
        .prepare(
          "INSERT INTO Printers (name, ipAddress, connectionDetails) VALUES (?, ?, ?)",
        )
        .run("Kitchen", "127.0.0.1", String(options.printerPort)).lastInsertRowid,
    );
  }

  const categoryId = Number(
    db
      .prepare(
        "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, ?, NULL)",
      )
      .run("Food", "", 0, 0, printerId).lastInsertRowid,
  );

  const menuItemId = Number(
    db
      .prepare(
        "INSERT INTO MenuItems (name, description, weight, price, isLocked, menuCategory_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("Burger", "", 0, 7.5, 0, categoryId).lastInsertRowid,
  );

  db.close();
  return { tableId, menuItemId, printerId };
}

test(
  "POST /orders/:orderId/print prints to assigned printer",
  { concurrency: false },
  async () => {
    const fakePrinter = await startFakePrinter();
    try {
      const eventPasscode = "print-ok-pass";
      const created = createActiveDbFixture({
        eventName: createEventPrefix("orders-print-ok"),
        eventPasscode,
        adminUsername: "chef",
        adminPassword: "secret123",
      }).event;
      const { tableId, menuItemId } = seedSchemaAndData(created.dbFilePath, {
        printerPort: fakePrinter.port,
        assignPrinter: true,
      });

      const app = await createAppFixture(buildApp);
      const auth = createAuthFixture(app);
      const waiter = await auth.loginWaiter({
        username: "print-waiter",
        eventPasscode,
      });

      const create = await app.inject({
        method: "POST",
        url: "/orders",
        headers: { authorization: `Bearer ${waiter.accessToken}` },
        payload: {
          tableId,
          items: [{ menuItemId, quantity: 2, specialRequests: "no onions" }],
        },
      });
      assert.equal(create.statusCode, 201);
      const orderId = (create.json() as { id: number }).id;

      const print = await app.inject({
        method: "POST",
        url: `/orders/${orderId}/print`,
        headers: { authorization: `Bearer ${waiter.accessToken}` },
      });

      assert.equal(print.statusCode, 200);
      const body = print.json() as {
        orderId: number;
        printingEnabled: boolean;
        results: Array<{ status: string; printerName: string; itemCount: number }>;
      };
      assert.equal(body.orderId, orderId);
      assert.equal(body.printingEnabled, true);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].status, "ok");
      assert.equal(body.results[0].printerName, "Kitchen");
      assert.equal(body.results[0].itemCount, 2);
      assert.ok(fakePrinter.getConnections() > 0);
    } finally {
      await fakePrinter.close();
    }
  },
);

test(
  "POST /orders/:orderId/print returns skipped when no printer assigned",
  { concurrency: false },
  async () => {
    const eventPasscode = "print-skip-pass";
    const created = createActiveDbFixture({
      eventName: createEventPrefix("orders-print-skip"),
      eventPasscode,
      adminUsername: "chef",
      adminPassword: "secret123",
    }).event;
    const { tableId, menuItemId } = seedSchemaAndData(created.dbFilePath, {
      assignPrinter: false,
    });

    const app = await createAppFixture(buildApp);
    const auth = createAuthFixture(app);
    const waiter = await auth.loginWaiter({
      username: "skip-waiter",
      eventPasscode,
    });

    const create = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { authorization: `Bearer ${waiter.accessToken}` },
      payload: { tableId, items: [{ menuItemId, quantity: 1 }] },
    });
    const orderId = (create.json() as { id: number }).id;

    const print = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/print`,
      headers: { authorization: `Bearer ${waiter.accessToken}` },
    });

    assert.equal(print.statusCode, 200);
    const body = print.json() as {
      printingEnabled: boolean;
      results: Array<{ status: string; code?: string }>;
    };
    assert.equal(body.printingEnabled, true);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].status, "skipped");
    assert.equal(body.results[0].code, "NO_PRINTER_ASSIGNED");
  },
);

test(
  "POST /orders/:orderId/print is a no-op when order.printTickets is false",
  { concurrency: false },
  async () => {
    const eventPasscode = "print-disabled-pass";
    const created = createActiveDbFixture({
      eventName: createEventPrefix("orders-print-disabled"),
      eventPasscode,
      adminUsername: "chef",
      adminPassword: "secret123",
    }).event;
    const { tableId, menuItemId } = seedSchemaAndData(created.dbFilePath, {
      assignPrinter: false,
    });

    const app = await createAppFixture(buildApp);
    const auth = createAuthFixture(app);
    const adminToken = await auth.loginAdmin({
      eventId: created.id,
      username: "chef",
      password: "secret123",
    });
    const waiter = await auth.loginWaiter({
      username: "disabled-waiter",
      eventPasscode,
    });

    const patchConfig = await app.inject({
      method: "PATCH",
      url: "/config",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { values: { "order.printTickets": "false" } },
    });
    assert.equal(patchConfig.statusCode, 200);

    const create = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { authorization: `Bearer ${waiter.accessToken}` },
      payload: { tableId, items: [{ menuItemId, quantity: 1 }] },
    });
    const orderId = (create.json() as { id: number }).id;

    const print = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/print`,
      headers: { authorization: `Bearer ${waiter.accessToken}` },
    });

    assert.equal(print.statusCode, 200);
    const body = print.json() as {
      printingEnabled: boolean;
      results: unknown[];
    };
    assert.equal(body.printingEnabled, false);
    assert.equal(body.results.length, 0);
  },
);

test(
  "waiter cannot print another waiter's order",
  { concurrency: false },
  async () => {
    const eventPasscode = "print-foreign-pass";
    const created = createActiveDbFixture({
      eventName: createEventPrefix("orders-print-foreign"),
      eventPasscode,
      adminUsername: "chef",
      adminPassword: "secret123",
    }).event;
    const { tableId, menuItemId } = seedSchemaAndData(created.dbFilePath, {
      assignPrinter: false,
    });

    const app = await createAppFixture(buildApp);
    const auth = createAuthFixture(app);
    const waiterA = await auth.loginWaiter({
      username: "foreign-waiter-a",
      eventPasscode,
    });
    const waiterB = await auth.loginWaiter({
      username: "foreign-waiter-b",
      eventPasscode,
    });

    const create = await app.inject({
      method: "POST",
      url: "/orders",
      headers: { authorization: `Bearer ${waiterA.accessToken}` },
      payload: { tableId, items: [{ menuItemId, quantity: 1 }] },
    });
    const orderId = (create.json() as { id: number }).id;

    const forbidden = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/print`,
      headers: { authorization: `Bearer ${waiterB.accessToken}` },
    });

    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error.code, "FORBIDDEN");
  },
);

test(
  "POST /orders/:orderId/print returns 404 for unknown order",
  { concurrency: false },
  async () => {
    const eventPasscode = "print-404-pass";
    createActiveDbFixture({
      eventName: createEventPrefix("orders-print-404"),
      eventPasscode,
      adminUsername: "chef",
      adminPassword: "secret123",
    });

    const app = await createAppFixture(buildApp);
    const auth = createAuthFixture(app);
    const waiter = await auth.loginWaiter({
      username: "missing-waiter",
      eventPasscode,
    });

    const response = await app.inject({
      method: "POST",
      url: "/orders/9999999/print",
      headers: { authorization: `Bearer ${waiter.accessToken}` },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "ORDER_NOT_FOUND");
  },
);
