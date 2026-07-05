import Database from "better-sqlite3";
import type {
  OrderDto,
  OrderItemDto,
  OrdersExportResponse,
  OrdersQuery,
  OrderSubmitRequest,
} from "@bstoema/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type RequestActor = {
  role: "admin" | "waiter";
  username?: string;
};

type OrderRow = {
  id: number;
  timestamp: string;
  tableId: number;
  userId: number;
};

type OrderItemRow = {
  id: number;
  menuItemId: number;
  quantity: number;
  specialRequests: string;
};

type UserRow = {
  id: number;
  username: string;
  isLocked: number;
};

export class OrderStore {
  constructor(private readonly eventStore: EventStore) {}

  private openActiveEventDb() {
    const activeEvent = this.eventStore.getActiveEvent();
    if (!activeEvent) {
      throw new ApiError(
        409,
        "NO_ACTIVE_EVENT",
        "No active event exists. Activate an event before calling this endpoint."
      );
    }

    const db = new Database(activeEvent.dbFilePath);
    this.ensureOrderSchema(db);
    return db;
  }

  private ensureOrderSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        isLocked INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Users_username_key ON Users(username);

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

      CREATE TABLE IF NOT EXISTS Orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        table_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS Orders_table_id_idx ON Orders(table_id);
      CREATE INDEX IF NOT EXISTS Orders_user_id_idx ON Orders(user_id);
      CREATE INDEX IF NOT EXISTS Orders_timestamp_idx ON Orders(timestamp);

      CREATE TABLE IF NOT EXISTS OrderItems (
        order_id INTEGER NOT NULL,
        menuItem_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        specialRequests TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (order_id, menuItem_id)
      );

      CREATE INDEX IF NOT EXISTS OrderItems_menuItem_id_idx ON OrderItems(menuItem_id);
      CREATE INDEX IF NOT EXISTS OrderItems_order_id_idx ON OrderItems(order_id);
    `);
  }

  private resolveUserByUsername(db: Database.Database, username: string): UserRow {
    const user = db
      .prepare("SELECT id, username, isLocked FROM Users WHERE username = ?")
      .get(username) as UserRow | undefined;

    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Session user is not available in active event");
    }

    if (user.isLocked === 1) {
      throw new ApiError(423, "USER_LOCKED", "User account is locked");
    }

    return user;
  }

  private resolveActorUser(db: Database.Database, actor: RequestActor): UserRow {
    if (!actor.username) {
      throw new ApiError(401, "UNAUTHORIZED", "Session token is missing username");
    }

    return this.resolveUserByUsername(db, actor.username);
  }

  private loadOrder(db: Database.Database, orderId: number): OrderDto | null {
    const orderRow = db
      .prepare(
        `
        SELECT id, timestamp, table_id as tableId, user_id as userId
        FROM Orders
        WHERE id = ?
        `
      )
      .get(orderId) as OrderRow | undefined;

    if (!orderRow) {
      return null;
    }

    const itemRows = db
      .prepare(
        `
        SELECT rowid as id, menuItem_id as menuItemId, quantity, specialRequests
        FROM OrderItems
        WHERE order_id = ?
        ORDER BY rowid
        `
      )
      .all(orderId) as OrderItemRow[];

    const items: OrderItemDto[] = itemRows.map((row) => ({
      id: row.id,
      menuItemId: row.menuItemId,
      quantity: row.quantity,
      ...(row.specialRequests ? { specialRequests: row.specialRequests } : {}),
    }));

    return {
      id: orderRow.id,
      timestamp: orderRow.timestamp,
      tableId: orderRow.tableId,
      userId: orderRow.userId,
      items,
    };
  }

  private assertOrderAccessible(order: OrderDto, actorUserId: number | null) {
    if (actorUserId !== null && order.userId !== actorUserId) {
      throw new ApiError(403, "FORBIDDEN", "Waiters can only access their own orders");
    }
  }

  private ensureTableForOrder(db: Database.Database, tableId: number) {
    const table = db
      .prepare("SELECT id, isLocked FROM Tables WHERE id = ?")
      .get(tableId) as { id: number; isLocked: number } | undefined;

    if (!table) {
      throw new ApiError(404, "TABLE_NOT_FOUND", "Table not found");
    }

    if (table.isLocked === 1) {
      throw new ApiError(409, "TABLE_LOCKED", "Table is locked");
    }
  }

  private ensureMenuItemsForOrder(
    db: Database.Database,
    items: Array<{ menuItemId: number; quantity: number }>
  ) {
    const dedupe = new Set<number>();
    for (const item of items) {
      if (dedupe.has(item.menuItemId)) {
        throw new ApiError(
          400,
          "DUPLICATE_MENU_ITEM",
          "Each menuItemId may only appear once in an order"
        );
      }
      dedupe.add(item.menuItemId);
    }

    const menuItemIds = items.map((item) => item.menuItemId);
    const placeholders = menuItemIds.map(() => "?").join(", ");

    const rows = db
      .prepare(
        `
        SELECT mi.id, mi.isLocked as itemLocked, mc.isLocked as categoryLocked
        FROM MenuItems mi
        JOIN MenuCategories mc ON mc.id = mi.menuCategory_id
        WHERE mi.id IN (${placeholders})
        `
      )
      .all(...menuItemIds) as Array<{
      id: number;
      itemLocked: number;
      categoryLocked: number;
    }>;

    const rowMap = new Map(rows.map((row) => [row.id, row]));
    for (const menuItemId of menuItemIds) {
      const row = rowMap.get(menuItemId);
      if (!row) {
        throw new ApiError(404, "MENU_ITEM_NOT_FOUND", "One or more menu items were not found", {
          menuItemId,
        });
      }

      if (row.itemLocked === 1) {
        throw new ApiError(409, "MENU_ITEM_LOCKED", "One or more menu items are locked", {
          menuItemId,
        });
      }

      if (row.categoryLocked === 1) {
        throw new ApiError(409, "MENU_CATEGORY_LOCKED", "One or more menu categories are locked", {
          menuItemId,
        });
      }
    }
  }

  private validateStockAvailability(
    db: Database.Database,
    items: Array<{ menuItemId: number; quantity: number }>
  ) {
    if (items.length === 0) {
      return;
    }

    const menuItemIds = items.map((item) => item.menuItemId);
    const quantitiesByMenuItem = new Map(items.map((item) => [item.menuItemId, item.quantity]));
    const placeholders = menuItemIds.map(() => "?").join(", ");

    const requirementRows = db
      .prepare(
        `
        SELECT stockItem_id as stockItemId, menuItem_id as menuItemId, quantityRequired
        FROM StockItemMenuItem
        WHERE menuItem_id IN (${placeholders})
        `
      )
      .all(...menuItemIds) as Array<{
      stockItemId: number;
      menuItemId: number;
      quantityRequired: number;
    }>;

    if (requirementRows.length === 0) {
      return;
    }

    const requiredByStockItem = new Map<number, number>();
    for (const row of requirementRows) {
      const multiplier = quantitiesByMenuItem.get(row.menuItemId) ?? 0;
      const current = requiredByStockItem.get(row.stockItemId) ?? 0;
      requiredByStockItem.set(row.stockItemId, current + row.quantityRequired * multiplier);
    }

    const stockItemIds = Array.from(requiredByStockItem.keys());
    const stockPlaceholders = stockItemIds.map(() => "?").join(", ");
    const stockRows = db
      .prepare(`SELECT id, quantity FROM StockItems WHERE id IN (${stockPlaceholders})`)
      .all(...stockItemIds) as Array<{ id: number; quantity: number }>;
    const stockMap = new Map(stockRows.map((row) => [row.id, row.quantity]));

    const insufficient = stockItemIds
      .map((stockItemId) => {
        const required = requiredByStockItem.get(stockItemId) ?? 0;
        const available = stockMap.get(stockItemId) ?? 0;
        return {
          stockItemId,
          required,
          available,
        };
      })
      .filter((item) => item.available < item.required);

    if (insufficient.length > 0) {
      throw new ApiError(422, "OUT_OF_STOCK", "Not enough stock for one or more menu items", {
        insufficient,
      });
    }
  }

  private consumeStock(db: Database.Database, items: Array<{ menuItemId: number; quantity: number }>) {
    if (items.length === 0) {
      return;
    }

    const menuItemIds = items.map((item) => item.menuItemId);
    const quantitiesByMenuItem = new Map(items.map((item) => [item.menuItemId, item.quantity]));
    const placeholders = menuItemIds.map(() => "?").join(", ");

    const requirementRows = db
      .prepare(
        `
        SELECT stockItem_id as stockItemId, menuItem_id as menuItemId, quantityRequired
        FROM StockItemMenuItem
        WHERE menuItem_id IN (${placeholders})
        `
      )
      .all(...menuItemIds) as Array<{
      stockItemId: number;
      menuItemId: number;
      quantityRequired: number;
    }>;

    if (requirementRows.length === 0) {
      return;
    }

    const requiredByStockItem = new Map<number, number>();
    for (const row of requirementRows) {
      const multiplier = quantitiesByMenuItem.get(row.menuItemId) ?? 0;
      const current = requiredByStockItem.get(row.stockItemId) ?? 0;
      requiredByStockItem.set(row.stockItemId, current + row.quantityRequired * multiplier);
    }

    const updateStock = db.prepare("UPDATE StockItems SET quantity = quantity - ? WHERE id = ?");
    for (const [stockItemId, required] of requiredByStockItem.entries()) {
      updateStock.run(required, stockItemId);
    }
  }

  listOrders(query: OrdersQuery, actor: RequestActor): OrderDto[] {
    const db = this.openActiveEventDb();
    try {
      if (actor.role !== "admin" && actor.role !== "waiter") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can access orders");
      }

      const actorUserId = actor.role === "waiter" ? this.resolveActorUser(db, actor).id : null;
      if (actorUserId !== null && query.userId !== undefined && query.userId !== actorUserId) {
        throw new ApiError(403, "FORBIDDEN", "Waiters can only query their own userId");
      }

      const where: string[] = [];
      const params: Array<string | number> = [];

      if (query.tableId !== undefined) {
        where.push("table_id = ?");
        params.push(query.tableId);
      }

      if (query.userId !== undefined) {
        where.push("user_id = ?");
        params.push(query.userId);
      } else if (actorUserId !== null) {
        where.push("user_id = ?");
        params.push(actorUserId);
      }

      if (query.from) {
        where.push("timestamp >= ?");
        params.push(query.from);
      }

      if (query.to) {
        where.push("timestamp <= ?");
        params.push(query.to);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = db
        .prepare(
          `
          SELECT id, timestamp, table_id as tableId, user_id as userId
          FROM Orders
          ${whereClause}
          ORDER BY timestamp DESC, id DESC
          `
        )
        .all(...params) as OrderRow[];

      return rows
        .map((row) => this.loadOrder(db, row.id))
        .filter((order): order is OrderDto => order !== null);
    } finally {
      db.close();
    }
  }

  // Flat dump of every order line for offline analysis: one row per order
  // item, denormalized with table/waiter/menu-item/category names. LEFT JOINs
  // keep rows whose referenced table/user/menu item was deleted after the
  // order was taken (names fall back to ""). unitPrice is the menu item's
  // current price — historical prices are not stored.
  exportOrders(): OrdersExportResponse {
    const db = this.openActiveEventDb();
    try {
      const rows = db
        .prepare(
          `
          SELECT
            o.id as orderId,
            o.timestamp,
            o.table_id as tableId,
            COALESCE(t.name, '') as tableName,
            o.user_id as userId,
            COALESCE(u.username, '') as waiterUsername,
            oi.menuItem_id as menuItemId,
            COALESCE(mi.name, '') as menuItemName,
            COALESCE(mc.name, '') as categoryName,
            oi.quantity,
            COALESCE(mi.price, 0) as unitPrice,
            oi.specialRequests
          FROM Orders o
          JOIN OrderItems oi ON oi.order_id = o.id
          LEFT JOIN Tables t ON t.id = o.table_id
          LEFT JOIN Users u ON u.id = o.user_id
          LEFT JOIN MenuItems mi ON mi.id = oi.menuItem_id
          LEFT JOIN MenuCategories mc ON mc.id = mi.menuCategory_id
          ORDER BY o.timestamp ASC, o.id ASC, oi.rowid ASC
          `
        )
        .all() as Array<{
        orderId: number;
        timestamp: string;
        tableId: number;
        tableName: string;
        userId: number;
        waiterUsername: string;
        menuItemId: number;
        menuItemName: string;
        categoryName: string;
        quantity: number;
        unitPrice: number;
        specialRequests: string;
      }>;

      return {
        exportedAt: new Date().toISOString(),
        rows: rows.map((row) => ({
          ...row,
          lineTotal: row.unitPrice * row.quantity,
        })),
      };
    } finally {
      db.close();
    }
  }

  getOrder(orderId: number, actor: RequestActor): OrderDto {
    const db = this.openActiveEventDb();
    try {
      if (actor.role !== "admin" && actor.role !== "waiter") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can access orders");
      }

      const actorUserId = actor.role === "waiter" ? this.resolveActorUser(db, actor).id : null;
      const order = this.loadOrder(db, orderId);
      if (!order) {
        throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
      }

      this.assertOrderAccessible(order, actorUserId);
      return order;
    } finally {
      db.close();
    }
  }

  submitOrder(input: OrderSubmitRequest, actor: RequestActor): OrderDto {
    const db = this.openActiveEventDb();
    try {
      if (actor.role !== "admin" && actor.role !== "waiter") {
        throw new ApiError(403, "FORBIDDEN", "Only waiter/admin roles can submit orders");
      }

      const actorUser = this.resolveActorUser(db, actor);
      this.ensureTableForOrder(db, input.tableId);
      this.ensureMenuItemsForOrder(db, input.items);
      this.validateStockAvailability(db, input.items);

      const createdOrderId = db.transaction(() => {
        const timestamp = new Date().toISOString();
        const orderInsert = db
          .prepare("INSERT INTO Orders (timestamp, table_id, user_id) VALUES (?, ?, ?)")
          .run(timestamp, input.tableId, actorUser.id);

        const orderId = Number(orderInsert.lastInsertRowid);
        const itemInsert = db.prepare(
          "INSERT INTO OrderItems (order_id, menuItem_id, quantity, specialRequests) VALUES (?, ?, ?, ?)"
        );

        for (const item of input.items) {
          itemInsert.run(orderId, item.menuItemId, item.quantity, item.specialRequests ?? "");
        }

        this.consumeStock(db, input.items);
        return orderId;
      })();

      const order = this.loadOrder(db, createdOrderId);
      if (!order) {
        throw new ApiError(500, "ORDER_CREATE_FAILED", "Failed to create order");
      }

      return order;
    } finally {
      db.close();
    }
  }
}

