import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { buildApp } from "../app";
import { eventStore } from "../domain/state";
import { setupEventTestUtils } from "../test-utils/event-test-utils";

const { createTestEvent, createEventPrefix, createAppFixture, createAuthFixture } = setupEventTestUtils(
  test,
  eventStore
);

function seedMenu(
  dbFilePath: string,
  input: {
    categories: Array<{
      name: string;
      weight: number;
      isLocked?: boolean;
      description?: string;
    }>;
    items: Array<{
      name: string;
      weight: number;
      price: number;
      menuCategoryId: number;
      isLocked?: boolean;
      description?: string;
    }>;
  }
) {
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
      description TEXT NOT NULL DEFAULT '',
      weight INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      isLocked INTEGER NOT NULL DEFAULT 0,
      menuCategory_id INTEGER NOT NULL
    );
  `);

  const categoryIds: number[] = [];
  const insertCategory = db.prepare(
    "INSERT INTO MenuCategories (name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, NULL, NULL)"
  );
  for (const category of input.categories) {
    const id = Number(
      insertCategory.run(
        category.name,
        category.description ?? "",
        category.isLocked ? 1 : 0,
        category.weight
      ).lastInsertRowid
    );
    categoryIds.push(id);
  }

  const insertItem = db.prepare(
    "INSERT INTO MenuItems (name, description, weight, price, isLocked, menuCategory_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const item of input.items) {
    insertItem.run(
      item.name,
      item.description ?? "",
      item.weight,
      item.price,
      item.isLocked ? 1 : 0,
      item.menuCategoryId
    );
  }

  db.close();
  return categoryIds;
}


test("menu endpoints reject unauthorized requests", { concurrency: false }, async () => {
  const app = await createAppFixture(buildApp);
  const response = await app.inject({
    method: "GET",
    url: "/menu/categories",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHORIZED");
});

test("menu endpoints require an active event", { concurrency: false }, async () => {
  const eventPasscode = "pass-no-active";
  const created = createTestEvent({
    eventName: createEventPrefix("menu-no-active"),
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
    url: "/menu/categories",
    headers: { authorization: `Bearer ${waiterToken}` },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "NO_ACTIVE_EVENT");
});

test("menu list returns only active event and sorts by weight", { concurrency: false }, async () => {
  const eventPasscode = "pass-sorting";
  const activeEvent = createTestEvent({
    eventName: createEventPrefix("menu-active"),
    eventPasscode,
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  eventStore.activateEvent(activeEvent.id);

  const [drinksId] = seedMenu(activeEvent.dbFilePath, {
    categories: [
      { name: "Drinks", weight: 2 },
      { name: "Food", weight: 1 },
    ],
    items: [
      { name: "Water", weight: 4, price: 2.5, menuCategoryId: 1 },
      { name: "Beer", weight: 1, price: 4.2, menuCategoryId: 1 },
    ],
  });

  const inactiveEvent = createTestEvent({
    eventName: createEventPrefix("menu-inactive"),
    eventPasscode: "pass-inactive",
    adminUsername: "chef",
    adminPassword: "secret123",
  });
  seedMenu(inactiveEvent.dbFilePath, {
    categories: [{ name: "Hidden", weight: 0 }],
    items: [],
  });

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const waiterToken = (await auth.loginWaiter({ username: "sort-waiter", eventPasscode })).accessToken;

  const categoriesResponse = await app.inject({
    method: "GET",
    url: "/menu/categories",
    headers: { authorization: `Bearer ${waiterToken}` },
  });

  assert.equal(categoriesResponse.statusCode, 200);
  const categories = (categoriesResponse.json() as { categories: Array<{ name: string }> }).categories;
  assert.deepEqual(
    categories.map((category) => category.name),
    ["Food", "Drinks"]
  );

  const itemsResponse = await app.inject({
    method: "GET",
    url: `/menu/items?categoryId=${drinksId}`,
    headers: { authorization: `Bearer ${waiterToken}` },
  });

  assert.equal(itemsResponse.statusCode, 200);
  const items = (itemsResponse.json() as { items: Array<{ name: string }> }).items;
  assert.deepEqual(
    items.map((item) => item.name),
    ["Beer", "Water"]
  );

});

test("admin CRUD for menu categories and items works", { concurrency: false }, async () => {
  const adminPassword = "secret123";
  const created = createTestEvent({
    eventName: createEventPrefix("menu-crud"),
    eventPasscode: "pass-crud",
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

  const createCategory = await app.inject({
    method: "POST",
    url: "/menu/categories",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "Desserts", weight: 10 },
  });
  assert.equal(createCategory.statusCode, 201);
  const categoryId = createCategory.json().id as number;

  const createItem = await app.inject({
    method: "POST",
    url: "/menu/items",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "Cake", price: 5.9, weight: 3, menuCategoryId: categoryId },
  });
  assert.equal(createItem.statusCode, 201);
  const menuItemId = createItem.json().id as number;

  const updateCategory = await app.inject({
    method: "PATCH",
    url: `/menu/categories/${categoryId}`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: "Sweet Desserts", isLocked: true },
  });
  assert.equal(updateCategory.statusCode, 200);
  assert.equal(updateCategory.json().name, "Sweet Desserts");
  assert.equal(updateCategory.json().isLocked, true);

  const updateItem = await app.inject({
    method: "PATCH",
    url: `/menu/items/${menuItemId}`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { weight: 1, price: 6.4 },
  });
  assert.equal(updateItem.statusCode, 200);
  assert.equal(updateItem.json().weight, 1);
  assert.equal(updateItem.json().price, 6.4);

  const deleteCategoryConflict = await app.inject({
    method: "DELETE",
    url: `/menu/categories/${categoryId}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleteCategoryConflict.statusCode, 409);
  assert.equal(deleteCategoryConflict.json().error.code, "MENU_CATEGORY_NOT_EMPTY");

  const deleteItem = await app.inject({
    method: "DELETE",
    url: `/menu/items/${menuItemId}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleteItem.statusCode, 204);

  const deleteCategory = await app.inject({
    method: "DELETE",
    url: `/menu/categories/${categoryId}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(deleteCategory.statusCode, 204);

});

test("admin can export a menu and import it into another event", { concurrency: false }, async () => {
  const adminPassword = "secret123";

  // ── Source event with a seeded menu ──────────────────────────────────────
  const source = createTestEvent({
    eventName: createEventPrefix("menu-export"),
    eventPasscode: "pass-export",
    adminUsername: "chef",
    adminPassword,
  });
  seedMenu(source.dbFilePath, {
    categories: [
      { name: "Getraenke", weight: 10 },
      { name: "Speisen", weight: 20, isLocked: true, description: "Warme Kueche" },
    ],
    // menuCategoryId here is the 1-based insertion order returned by seedMenu.
    items: [
      { name: "Cola", weight: 10, price: 3.5, menuCategoryId: 1 },
      { name: "Bier", weight: 20, price: 4.2, menuCategoryId: 1 },
      { name: "Schnitzel", weight: 10, price: 14.9, menuCategoryId: 2, isLocked: true },
    ],
  });
  eventStore.activateEvent(source.id);

  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const sourceToken = await auth.loginAdmin({
    eventId: source.id,
    username: "chef",
    password: adminPassword,
  });

  const exportRes = await app.inject({
    method: "GET",
    url: "/menu/export",
    headers: { authorization: `Bearer ${sourceToken}` },
  });
  assert.equal(exportRes.statusCode, 200);
  const exported = exportRes.json() as {
    formatVersion: number;
    categories: Array<{ name: string; items: Array<{ name: string; price: number }> }>;
  };
  assert.equal(exported.formatVersion, 1);
  assert.deepEqual(
    exported.categories.map((c) => c.name),
    ["Getraenke", "Speisen"],
  );
  assert.deepEqual(
    exported.categories[0].items.map((i) => i.name),
    ["Cola", "Bier"],
  );

  // ── Target event (empty menu) ────────────────────────────────────────────
  const target = createTestEvent({
    eventName: createEventPrefix("menu-import"),
    eventPasscode: "pass-import",
    adminUsername: "chef",
    adminPassword,
  });
  eventStore.activateEvent(target.id);
  const targetToken = await auth.loginAdmin({
    eventId: target.id,
    username: "chef",
    password: adminPassword,
  });

  const importRes = await app.inject({
    method: "POST",
    url: "/menu/import",
    headers: { authorization: `Bearer ${targetToken}` },
    payload: { menu: exported },
  });
  assert.equal(importRes.statusCode, 200);
  assert.deepEqual(importRes.json(), {
    mode: "merge",
    categoriesCreated: 2,
    categoriesUpdated: 0,
    itemsCreated: 3,
    itemsUpdated: 0,
  });

  // Menu now exists in the target event.
  const targetCats = await app.inject({
    method: "GET",
    url: "/menu/categories",
    headers: { authorization: `Bearer ${targetToken}` },
  });
  assert.deepEqual(
    (targetCats.json() as { categories: Array<{ name: string }> }).categories.map((c) => c.name),
    ["Getraenke", "Speisen"],
  );
  const targetItems = await app.inject({
    method: "GET",
    url: "/menu/items",
    headers: { authorization: `Bearer ${targetToken}` },
  });
  const items = (targetItems.json() as { items: Array<{ name: string; isLocked: boolean }> }).items;
  assert.equal(items.length, 3);
  assert.equal(items.find((i) => i.name === "Schnitzel")?.isLocked, true);

  // Re-importing the same file is idempotent (upsert by name, no duplicates).
  const reimport = await app.inject({
    method: "POST",
    url: "/menu/import",
    headers: { authorization: `Bearer ${targetToken}` },
    payload: { menu: exported },
  });
  assert.equal(reimport.statusCode, 200);
  assert.deepEqual(reimport.json(), {
    mode: "merge",
    categoriesCreated: 0,
    categoriesUpdated: 2,
    itemsCreated: 0,
    itemsUpdated: 3,
  });
  const afterReimport = await app.inject({
    method: "GET",
    url: "/menu/items",
    headers: { authorization: `Bearer ${targetToken}` },
  });
  assert.equal((afterReimport.json() as { items: unknown[] }).items.length, 3);
});

