import assert from "node:assert/strict";
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

function seedOrderBaseData(dbFilePath: string) {
  const db = new Database(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS Tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      isLocked INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS StockItems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS StockItemMenuItem (
      stockItem_id INTEGER NOT NULL,
      menuItem_id INTEGER NOT NULL,
      quantityRequired INTEGER NOT NULL,
      PRIMARY KEY (stockItem_id, menuItem_id)
    );
  `);

  const tableId = Number(
    db.prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)").run("A1", 1, 0)
      .lastInsertRowid
  );

  const categoryId = Number(
    db
      .prepare(
        "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run("Food", "", 0, 0, null, null).lastInsertRowid
  );

  const menuItemId = Number(
    db.prepare(
      "INSERT INTO MenuItems (name, description, weight, price, isLocked, menuCategory_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("Burger", "", 0, 7.5, 0, categoryId).lastInsertRowid
  );

  const stockItemId = Number(
    db.prepare("INSERT INTO StockItems (name, quantity) VALUES (?, ?)").run("Bun", 10).lastInsertRowid
  );

  db.prepare(
    "INSERT INTO StockItemMenuItem (stockItem_id, menuItem_id, quantityRequired) VALUES (?, ?, ?)"
  ).run(stockItemId, menuItemId, 1);

  db.close();
  return { tableId, menuItemId, stockItemId };
}

test("orders endpoints reject unauthorized requests", { concurrency: false }, async () => {
  const app = await createAppFixture(buildApp);
  const response = await app.inject({
    method: "GET",
    url: "/orders",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHORIZED");
});

test("orders endpoints require active event", { concurrency: false }, async () => {
  const created = createActiveDbFixture({
    eventName: createEventPrefix("orders-no-active"),
    eventPasscode: "orders-pass",
    adminUsername: "chef",
    adminPassword: "secret123",
  }).event;

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiter = await auth.loginWaiter({ username: "noactive-waiter", eventPasscode: "orders-pass" });

  eventStore.deactivateEvent(created.id);

  const response = await app.inject({
    method: "GET",
    url: "/orders",
    headers: { authorization: `Bearer ${waiter.accessToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "NO_ACTIVE_EVENT");
});

test("waiter can create/list own orders but not access other waiter orders", { concurrency: false }, async () => {
  const eventPasscode = "orders-own-pass";
  const created = createActiveDbFixture({
    eventName: createEventPrefix("orders-own"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  }).event;
  const { tableId, menuItemId, stockItemId } = seedOrderBaseData(created.dbFilePath);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterA = await auth.loginWaiter({ username: "waiter-a", eventPasscode });
  const waiterB = await auth.loginWaiter({ username: "waiter-b", eventPasscode });

  const createdOrder = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiterA.accessToken}` },
    payload: {
      tableId,
      items: [{ menuItemId, quantity: 2, specialRequests: "No onions" }],
    },
  });

  assert.equal(createdOrder.statusCode, 201);
  const orderBody = createdOrder.json() as { id: number; userId: number; items: Array<{ quantity: number }> };
  assert.equal(orderBody.userId, waiterA.user.id);
  assert.equal(orderBody.items[0].quantity, 2);

  const listOwn = await app.inject({
    method: "GET",
    url: "/orders",
    headers: { authorization: `Bearer ${waiterA.accessToken}` },
  });
  assert.equal(listOwn.statusCode, 200);
  assert.equal((listOwn.json() as { orders: Array<{ id: number }> }).orders.length, 1);

  const listOtherUserId = await app.inject({
    method: "GET",
    url: `/orders?userId=${waiterB.user.id}`,
    headers: { authorization: `Bearer ${waiterA.accessToken}` },
  });
  assert.equal(listOtherUserId.statusCode, 403);

  const getByOtherWaiter = await app.inject({
    method: "GET",
    url: `/orders/${orderBody.id}`,
    headers: { authorization: `Bearer ${waiterB.accessToken}` },
  });
  assert.equal(getByOtherWaiter.statusCode, 403);

  const db = new Database(created.dbFilePath);
  const stock = db.prepare("SELECT quantity FROM StockItems WHERE id = ?").get(stockItemId) as {
    quantity: number;
  };
  assert.equal(stock.quantity, 8);
  db.close();

});

test("admin can list all orders and filter by user", { concurrency: false }, async () => {
  const eventPasscode = "orders-admin-pass";
  const adminPassword = "secret123";
  const created = createActiveDbFixture({
    eventName: createEventPrefix("orders-admin"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword,
  }).event;
  const { tableId, menuItemId } = seedOrderBaseData(created.dbFilePath);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterA = await auth.loginWaiter({ username: "waiter-admin-a", eventPasscode });
  const waiterB = await auth.loginWaiter({ username: "waiter-admin-b", eventPasscode });
  const adminToken = await auth.loginAdmin({
    eventId: created.id,
    username: "chef",
    password: adminPassword,
  });

  await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiterA.accessToken}` },
    payload: {
      tableId,
      items: [{ menuItemId, quantity: 1 }],
    },
  });

  await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiterB.accessToken}` },
    payload: {
      tableId,
      items: [{ menuItemId, quantity: 1 }],
    },
  });

  const listAll = await app.inject({
    method: "GET",
    url: "/orders",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(listAll.statusCode, 200);
  assert.equal((listAll.json() as { orders: unknown[] }).orders.length, 2);

  const filtered = await app.inject({
    method: "GET",
    url: `/orders?userId=${waiterA.user.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(filtered.statusCode, 200);
  assert.equal((filtered.json() as { orders: unknown[] }).orders.length, 1);

});

test("orders endpoint returns proper edge-case errors", { concurrency: false }, async () => {
  const eventPasscode = "orders-errors-pass";
  const created = createActiveDbFixture({
    eventName: createEventPrefix("orders-errors"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  }).event;

  const db = new Database(created.dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS Tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      isLocked INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE IF NOT EXISTS StockItems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS StockItemMenuItem (
      stockItem_id INTEGER NOT NULL,
      menuItem_id INTEGER NOT NULL,
      quantityRequired INTEGER NOT NULL,
      PRIMARY KEY (stockItem_id, menuItem_id)
    );
  `);

  const lockedTableId = Number(
    db.prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)").run("L1", 0, 1)
      .lastInsertRowid
  );
  const openTableId = Number(
    db.prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)").run("L2", 1, 0)
      .lastInsertRowid
  );

  const openCategoryId = Number(
    db
      .prepare(
        "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run("Open", "", 0, 0, null, null).lastInsertRowid
  );
  const lockedCategoryId = Number(
    db
      .prepare(
        "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run("Locked", "", 1, 0, null, null).lastInsertRowid
  );

  const outOfStockMenuItemId = Number(
    db.prepare(
      "INSERT INTO MenuItems (name, description, weight, price, isLocked, menuCategory_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("Fries", "", 0, 3.2, 0, openCategoryId).lastInsertRowid
  );
  const lockedMenuItemId = Number(
    db.prepare(
      "INSERT INTO MenuItems (name, description, weight, price, isLocked, menuCategory_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("Soup", "", 0, 4.1, 0, lockedCategoryId).lastInsertRowid
  );

  const stockItemId = Number(
    db.prepare("INSERT INTO StockItems (name, quantity) VALUES (?, ?)").run("Potato", 0).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO StockItemMenuItem (stockItem_id, menuItem_id, quantityRequired) VALUES (?, ?, ?)"
  ).run(stockItemId, outOfStockMenuItemId, 1);

  db.close();

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiter = await auth.loginWaiter({ username: "waiter-errors", eventPasscode });

  const lockedTable = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiter.accessToken}` },
    payload: {
      tableId: lockedTableId,
      items: [{ menuItemId: outOfStockMenuItemId, quantity: 1 }],
    },
  });
  assert.equal(lockedTable.statusCode, 409);
  assert.equal(lockedTable.json().error.code, "TABLE_LOCKED");

  const lockedCategory = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiter.accessToken}` },
    payload: {
      tableId: openTableId,
      items: [{ menuItemId: lockedMenuItemId, quantity: 1 }],
    },
  });
  assert.equal(lockedCategory.statusCode, 409);
  assert.equal(lockedCategory.json().error.code, "MENU_CATEGORY_LOCKED");

  const outOfStock = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiter.accessToken}` },
    payload: {
      tableId: openTableId,
      items: [{ menuItemId: outOfStockMenuItemId, quantity: 1 }],
    },
  });
  assert.equal(outOfStock.statusCode, 422);
  assert.equal(outOfStock.json().error.code, "OUT_OF_STOCK");

});

test("admin can export all order data as flat rows; waiters cannot", { concurrency: false }, async () => {
  const eventPasscode = "orders-export-pass";
  const adminPassword = "secret123";
  const created = createActiveDbFixture({
    eventName: createEventPrefix("orders-export"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword,
  }).event;
  const { tableId, menuItemId } = seedOrderBaseData(created.dbFilePath);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterA = await auth.loginWaiter({ username: "waiter-export-a", eventPasscode });
  const waiterB = await auth.loginWaiter({ username: "waiter-export-b", eventPasscode });
  const adminToken = await auth.loginAdmin({
    eventId: created.id,
    username: "chef",
    password: adminPassword,
  });

  const firstOrder = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiterA.accessToken}` },
    payload: {
      tableId,
      items: [{ menuItemId, quantity: 2, specialRequests: "No onions" }],
    },
  });
  assert.equal(firstOrder.statusCode, 201);

  const secondOrder = await app.inject({
    method: "POST",
    url: "/orders",
    headers: { authorization: `Bearer ${waiterB.accessToken}` },
    payload: {
      tableId,
      items: [{ menuItemId, quantity: 1 }],
    },
  });
  assert.equal(secondOrder.statusCode, 201);

  const forbidden = await app.inject({
    method: "GET",
    url: "/orders/export",
    headers: { authorization: `Bearer ${waiterA.accessToken}` },
  });
  assert.equal(forbidden.statusCode, 403);

  const exportRes = await app.inject({
    method: "GET",
    url: "/orders/export",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(exportRes.statusCode, 200);

  const body = exportRes.json() as {
    exportedAt: string;
    rows: Array<{
      orderId: number;
      timestamp: string;
      tableName: string;
      waiterUsername: string;
      menuItemName: string;
      categoryName: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      specialRequests: string;
    }>;
  };

  assert.equal(body.rows.length, 2);

  const first = body.rows[0];
  assert.equal(first.orderId, (firstOrder.json() as { id: number }).id);
  assert.equal(first.tableName, "A1");
  assert.equal(first.waiterUsername, "waiter-export-a");
  assert.equal(first.menuItemName, "Burger");
  assert.equal(first.categoryName, "Food");
  assert.equal(first.quantity, 2);
  assert.equal(first.unitPrice, 7.5);
  assert.equal(first.lineTotal, 15);
  assert.equal(first.specialRequests, "No onions");

  const second = body.rows[1];
  assert.equal(second.waiterUsername, "waiter-export-b");
  assert.equal(second.quantity, 1);
  assert.equal(second.lineTotal, 7.5);
  assert.equal(second.specialRequests, "");
});

