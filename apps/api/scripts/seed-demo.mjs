// Demo data seeder for screenshots / local demos.
//
// Creates (idempotently) one active event with a realistic menu, tables,
// waiters and a few orders, so the apps render with real-looking content.
//
// Usage (API must already be running on :8787):
//   node apps/api/scripts/seed-demo.mjs
//
// Or import { seedDemo } from this file (used by the Playwright screenshot specs).

const DEFAULTS = {
  baseUrl: process.env.SERVA_API_URL ?? "http://localhost:8787",
  masterUsername: process.env.MASTER_USERNAME ?? "master",
  masterPassword: process.env.MASTER_PASSWORD ?? "2009",
};

export const DEMO = {
  eventName: "Sommerfest 2026",
  eventPasscode: "sommer26",
  adminUsername: "admin",
  adminPassword: "admin1234",
  waiter: "Anna",
};

async function api(baseUrl, path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return data;
}

const CATEGORIES = [
  {
    name: "Getränke",
    description: "Erfrischungen vom Fass und aus der Flasche",
    items: [
      { name: "Helles 0,5l", price: 4.5, description: "Frisch gezapft" },
      { name: "Weißbier 0,5l", price: 4.8 },
      { name: "Aperol Spritz", price: 7.5, description: "Mit Prosecco & Soda" },
      { name: "Cola 0,4l", price: 3.5 },
      { name: "Mineralwasser 0,4l", price: 3.0 },
      { name: "Hauswein weiß 0,2l", price: 5.5 },
    ],
  },
  {
    name: "Speisen",
    description: "Herzhaftes vom Grill und aus der Küche",
    items: [
      { name: "Bratwurst mit Brötchen", price: 5.5, description: "Vom Holzkohlegrill" },
      { name: "Pommes Frites", price: 4.0, description: "Mit Ketchup oder Mayo" },
      { name: "Currywurst", price: 6.5 },
      { name: "Flammkuchen", price: 9.5, description: "Speck & Zwiebeln" },
      { name: "Vegetarischer Burger", price: 11.0 },
    ],
  },
  {
    name: "Desserts",
    description: "Süßes zum Abschluss",
    items: [
      { name: "Kaiserschmarrn", price: 7.0, description: "Mit Apfelmus" },
      { name: "Eisbecher", price: 5.5, description: "Drei Kugeln nach Wahl" },
    ],
  },
];

const TABLES = [
  "Tisch 1", "Tisch 2", "Tisch 3", "Tisch 4",
  "Tisch 5", "Tisch 6", "Bar", "Terrasse 1", "Terrasse 2",
];

const WAITERS = ["Anna", "Ben", "Clara"];

/**
 * Seed an active demo event with menu, tables, waiters and orders.
 * Idempotent: reuses an existing event of the same name and skips
 * sub-resources that are already populated.
 */
export async function seedDemo(opts = {}) {
  const baseUrl = opts.baseUrl ?? DEFAULTS.baseUrl;
  const log = opts.log ?? ((m) => console.log(`[seed] ${m}`));

  // 1. Master login
  const master = await api(baseUrl, "/auth/master/login", {
    method: "POST",
    body: {
      username: opts.masterUsername ?? DEFAULTS.masterUsername,
      password: opts.masterPassword ?? DEFAULTS.masterPassword,
    },
  });
  log("master logged in");

  // 2. Find-or-create the demo event
  const events = await api(baseUrl, "/admin/events", { token: master.accessToken });
  let event = events.find((e) => e.eventName === DEMO.eventName && !e.closedAt);
  if (!event) {
    event = await api(baseUrl, "/admin/events", {
      method: "POST",
      token: master.accessToken,
      body: {
        eventName: DEMO.eventName,
        eventPasscode: DEMO.eventPasscode,
        adminUsername: DEMO.adminUsername,
        adminPassword: DEMO.adminPassword,
      },
    });
    log(`created event #${event.id}`);
  } else {
    log(`reusing event #${event.id}`);
  }

  // 3. Make sure it's the active event
  if (!event.isActive) {
    await api(baseUrl, `/admin/events/${event.id}/activate`, {
      method: "POST",
      token: master.accessToken,
    });
    log("activated event");
  }

  // 4. Admin login (scoped to the event)
  const admin = await api(baseUrl, "/auth/admin/login", {
    method: "POST",
    body: { eventId: event.id, username: DEMO.adminUsername, password: DEMO.adminPassword },
  });
  log("admin logged in");

  // 5. Menu (skip if categories already exist)
  const existingCats = await api(baseUrl, "/menu/categories", { token: admin.accessToken });
  if (existingCats.categories.length === 0) {
    let weight = 0;
    for (const cat of CATEGORIES) {
      const created = await api(baseUrl, "/menu/categories", {
        method: "POST",
        token: admin.accessToken,
        body: { name: cat.name, description: cat.description, weight: weight++ },
      });
      let itemWeight = 0;
      for (const item of cat.items) {
        await api(baseUrl, "/menu/items", {
          method: "POST",
          token: admin.accessToken,
          body: {
            name: item.name,
            description: item.description,
            price: item.price,
            weight: itemWeight++,
            menuCategoryId: created.id,
          },
        });
      }
      log(`menu: ${cat.name} (+${cat.items.length} items)`);
    }
  } else {
    log("menu already seeded");
  }

  // 6. Tables
  const existingTables = await api(baseUrl, "/tables", { token: admin.accessToken });
  if (existingTables.tables.length === 0) {
    let weight = 0;
    for (const name of TABLES) {
      await api(baseUrl, "/tables", {
        method: "POST",
        token: admin.accessToken,
        body: { name, weight: weight++ },
      });
    }
    log(`tables: +${TABLES.length}`);
  } else {
    log("tables already seeded");
  }

  // 7. Waiters
  const existingUsers = await api(baseUrl, "/users", { token: admin.accessToken });
  if (existingUsers.users.length === 0) {
    for (const username of WAITERS) {
      await api(baseUrl, "/users", {
        method: "POST",
        token: admin.accessToken,
        body: { username },
      });
    }
    log(`waiters: +${WAITERS.length}`);
  } else {
    log("waiters already seeded");
  }

  // 8. A few orders (waiter token) — only if none exist yet
  const existingOrders = await api(baseUrl, "/orders", { token: admin.accessToken });
  if (existingOrders.orders.length === 0) {
    const waiter = await api(baseUrl, "/auth/login", {
      method: "POST",
      body: { username: DEMO.waiter, eventPasscode: DEMO.eventPasscode },
    });
    const tables = (await api(baseUrl, "/tables", { token: admin.accessToken })).tables;
    const items = [];
    const cats = (await api(baseUrl, "/menu/categories", { token: admin.accessToken })).categories;
    for (const cat of cats) {
      const catItems = await api(baseUrl, `/menu/items?categoryId=${cat.id}`, {
        token: admin.accessToken,
      });
      items.push(...catItems.items);
    }
    const pick = (i) => items[i % items.length];
    const orderPlans = [
      { tableIdx: 0, lines: [[0, 2], [6, 1], [7, 1]] },
      { tableIdx: 1, lines: [[2, 1], [3, 2]] },
      { tableIdx: 3, lines: [[8, 1], [11, 1], [4, 2]] },
      { tableIdx: 6, lines: [[1, 3], [10, 1]] },
    ];
    for (const plan of orderPlans) {
      const table = tables[plan.tableIdx];
      if (!table) continue;
      await api(baseUrl, "/orders", {
        method: "POST",
        token: waiter.accessToken,
        body: {
          tableId: table.id,
          items: plan.lines.map(([i, qty]) => ({ menuItemId: pick(i).id, quantity: qty })),
        },
      });
    }
    log(`orders: +${orderPlans.length}`);
  } else {
    log("orders already seeded");
  }

  log("done");
  return { event, passcode: DEMO.eventPasscode, admin: DEMO, baseUrl };
}

// Run directly: `node apps/api/scripts/seed-demo.mjs`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed-demo.mjs")) {
  seedDemo().catch((err) => {
    console.error("[seed] FAILED:", err.message);
    process.exit(1);
  });
}
