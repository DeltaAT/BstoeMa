import Database from "better-sqlite3";
import type { EventBackupData, EventBackupEvent, EventBackupFile } from "@bstoema/shared-types";
import { ApiError } from "./api-error";
import type { EventRecord, EventStore } from "./event-store";

// Full-fidelity export/import of whole events. The export walks every domain
// table of an event database (plus the control-DB metadata) into a portable
// JSON structure; the import recreates it as a brand-new inactive event with
// the original row ids preserved — safe because the target event DB is always
// freshly created and empty. PrintQueue and Announcements are deliberately
// left out: both are transient operational state, not event content.

export class EventBackupStore {
  constructor(private readonly eventStore: EventStore) {}

  // Union of every store's lazily-created DDL, so exporting a young event that
  // never touched some domain (and importing into a fresh DB) always finds the
  // tables it reads/writes.
  private ensureBackupSchema(db: Database.Database) {
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

      CREATE TABLE IF NOT EXISTS Configurations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Configurations_name_key ON Configurations(name);

      CREATE TABLE IF NOT EXISTS Printers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ipAddress TEXT NOT NULL,
        connectionDetails TEXT NOT NULL DEFAULT ''
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Printers_name_key ON Printers(name);

      CREATE TABLE IF NOT EXISTS OrderDisplays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ipAddress TEXT NOT NULL,
        connectionDetails TEXT NOT NULL DEFAULT ''
      );

      CREATE UNIQUE INDEX IF NOT EXISTS OrderDisplays_name_key ON OrderDisplays(name);
    `);
  }

  // Rows are read in id order (configurations by name) so exports of identical
  // data are byte-for-byte comparable.
  private readEventData(dbFilePath: string): EventBackupData {
    const db = new Database(dbFilePath);
    try {
      this.ensureBackupSchema(db);

      const users = (
        db.prepare("SELECT id, username, isLocked FROM Users ORDER BY id").all() as Array<{
          id: number;
          username: string;
          isLocked: number;
        }>
      ).map((r) => ({ id: r.id, username: r.username, isLocked: r.isLocked === 1 }));

      const tables = (
        db.prepare("SELECT id, name, weight, isLocked FROM Tables ORDER BY id").all() as Array<{
          id: number;
          name: string;
          weight: number;
          isLocked: number;
        }>
      ).map((r) => ({ id: r.id, name: r.name, weight: r.weight, isLocked: r.isLocked === 1 }));

      const menuCategories = (
        db
          .prepare(
            "SELECT id, name, description, isLocked, weight, printer_id, orderDisplay_id FROM MenuCategories ORDER BY id"
          )
          .all() as Array<{
          id: number;
          name: string;
          description: string;
          isLocked: number;
          weight: number;
          printer_id: number | null;
          orderDisplay_id: number | null;
        }>
      ).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isLocked: r.isLocked === 1,
        weight: r.weight,
        printerId: r.printer_id,
        orderDisplayId: r.orderDisplay_id,
      }));

      const menuItems = (
        db
          .prepare(
            "SELECT id, name, description, weight, price, isLocked, menuCategory_id FROM MenuItems ORDER BY id"
          )
          .all() as Array<{
          id: number;
          name: string;
          description: string;
          weight: number;
          price: number;
          isLocked: number;
          menuCategory_id: number;
        }>
      ).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        weight: r.weight,
        price: r.price,
        isLocked: r.isLocked === 1,
        menuCategoryId: r.menuCategory_id,
      }));

      const stockItems = db
        .prepare("SELECT id, name, quantity FROM StockItems ORDER BY id")
        .all() as Array<{ id: number; name: string; quantity: number }>;

      const stockItemMenuItems = (
        db
          .prepare(
            "SELECT stockItem_id, menuItem_id, quantityRequired FROM StockItemMenuItem ORDER BY stockItem_id, menuItem_id"
          )
          .all() as Array<{
          stockItem_id: number;
          menuItem_id: number;
          quantityRequired: number;
        }>
      ).map((r) => ({
        stockItemId: r.stockItem_id,
        menuItemId: r.menuItem_id,
        quantityRequired: r.quantityRequired,
      }));

      const orders = (
        db.prepare("SELECT id, timestamp, table_id, user_id FROM Orders ORDER BY id").all() as Array<{
          id: number;
          timestamp: string;
          table_id: number;
          user_id: number;
        }>
      ).map((r) => ({ id: r.id, timestamp: r.timestamp, tableId: r.table_id, userId: r.user_id }));

      const orderItems = (
        db
          .prepare(
            "SELECT order_id, menuItem_id, quantity, specialRequests FROM OrderItems ORDER BY order_id, menuItem_id"
          )
          .all() as Array<{
          order_id: number;
          menuItem_id: number;
          quantity: number;
          specialRequests: string;
        }>
      ).map((r) => ({
        orderId: r.order_id,
        menuItemId: r.menuItem_id,
        quantity: r.quantity,
        specialRequests: r.specialRequests,
      }));

      const configurations = db
        .prepare("SELECT name, value FROM Configurations ORDER BY name")
        .all() as Array<{ name: string; value: string }>;

      const printers = db
        .prepare("SELECT id, name, ipAddress, connectionDetails FROM Printers ORDER BY id")
        .all() as Array<{ id: number; name: string; ipAddress: string; connectionDetails: string }>;

      const orderDisplays = db
        .prepare("SELECT id, name, ipAddress, connectionDetails FROM OrderDisplays ORDER BY id")
        .all() as Array<{ id: number; name: string; ipAddress: string; connectionDetails: string }>;

      return {
        users,
        tables,
        menuCategories,
        menuItems,
        stockItems,
        stockItemMenuItems,
        orders,
        orderItems,
        configurations,
        printers,
        orderDisplays,
      };
    } finally {
      db.close();
    }
  }

  private exportEvent(eventId: number): EventBackupEvent {
    const meta = this.eventStore.getEventBackupMeta(eventId);
    return {
      eventName: meta.eventName,
      createdAt: meta.createdAt,
      closedAt: meta.closedAt ?? undefined,
      adminUsername: meta.adminUsername,
      adminPasswordHash: meta.adminPasswordHash,
      eventPasscode: meta.eventPasscode,
      eventPasscodeHash: meta.eventPasscodeHash,
      data: this.readEventData(meta.dbFilePath),
    };
  }

  /** Exports the given events (or all events when omitted) as one backup file. */
  exportFile(eventIds?: number[]): EventBackupFile {
    const ids = eventIds ?? this.eventStore.listAllEvents().map((event) => event.id);
    return {
      kind: "bstoema-event-backup",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      events: ids.map((id) => this.exportEvent(id)),
    };
  }

  // The imported event name must be unique; a collision gets a " (Import)" /
  // " (Import 2)" ... suffix instead of failing, so restoring next to the
  // original (e.g. to compare) just works.
  private resolveFreeEventName(eventName: string) {
    if (!this.eventStore.eventNameExists(eventName)) {
      return eventName;
    }

    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? `${eventName} (Import)` : `${eventName} (Import ${attempt})`;
      if (!this.eventStore.eventNameExists(candidate)) {
        return candidate;
      }
    }
  }

  private writeEventData(dbFilePath: string, data: EventBackupData) {
    const db = new Database(dbFilePath);
    try {
      this.ensureBackupSchema(db);

      const insUser = db.prepare("INSERT INTO Users (id, username, isLocked) VALUES (?, ?, ?)");
      const insTable = db.prepare("INSERT INTO Tables (id, name, weight, isLocked) VALUES (?, ?, ?, ?)");
      const insCategory = db.prepare(
        "INSERT INTO MenuCategories (id, name, description, isLocked, weight, printer_id, orderDisplay_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const insItem = db.prepare(
        "INSERT INTO MenuItems (id, name, description, weight, price, isLocked, menuCategory_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const insStock = db.prepare("INSERT INTO StockItems (id, name, quantity) VALUES (?, ?, ?)");
      const insStockLink = db.prepare(
        "INSERT INTO StockItemMenuItem (stockItem_id, menuItem_id, quantityRequired) VALUES (?, ?, ?)"
      );
      const insOrder = db.prepare("INSERT INTO Orders (id, timestamp, table_id, user_id) VALUES (?, ?, ?, ?)");
      const insOrderItem = db.prepare(
        "INSERT INTO OrderItems (order_id, menuItem_id, quantity, specialRequests) VALUES (?, ?, ?, ?)"
      );
      const insConfig = db.prepare("INSERT INTO Configurations (name, value) VALUES (?, ?)");
      const insPrinter = db.prepare(
        "INSERT INTO Printers (id, name, ipAddress, connectionDetails) VALUES (?, ?, ?, ?)"
      );
      const insDisplay = db.prepare(
        "INSERT INTO OrderDisplays (id, name, ipAddress, connectionDetails) VALUES (?, ?, ?, ?)"
      );

      db.transaction(() => {
        for (const u of data.users) insUser.run(u.id, u.username, u.isLocked ? 1 : 0);
        for (const t of data.tables) insTable.run(t.id, t.name, t.weight, t.isLocked ? 1 : 0);
        for (const p of data.printers) insPrinter.run(p.id, p.name, p.ipAddress, p.connectionDetails);
        for (const d of data.orderDisplays) insDisplay.run(d.id, d.name, d.ipAddress, d.connectionDetails);
        for (const c of data.menuCategories) {
          insCategory.run(c.id, c.name, c.description, c.isLocked ? 1 : 0, c.weight, c.printerId, c.orderDisplayId);
        }
        for (const i of data.menuItems) {
          insItem.run(i.id, i.name, i.description, i.weight, i.price, i.isLocked ? 1 : 0, i.menuCategoryId);
        }
        for (const s of data.stockItems) insStock.run(s.id, s.name, s.quantity);
        for (const l of data.stockItemMenuItems) insStockLink.run(l.stockItemId, l.menuItemId, l.quantityRequired);
        for (const o of data.orders) insOrder.run(o.id, o.timestamp, o.tableId, o.userId);
        for (const oi of data.orderItems) {
          insOrderItem.run(oi.orderId, oi.menuItemId, oi.quantity, oi.specialRequests);
        }
        for (const c of data.configurations) insConfig.run(c.name, c.value);
      })();
    } finally {
      db.close();
    }
  }

  /**
   * Imports every event in the backup file as a new, inactive event.
   * All-or-nothing: if any event fails, the ones created earlier in the same
   * call are deleted again so a broken file never leaves partial state behind.
   */
  importFile(file: EventBackupFile): EventRecord[] {
    const created: EventRecord[] = [];

    try {
      for (const backupEvent of file.events) {
        const event = this.eventStore.createEventFromBackup({
          eventName: this.resolveFreeEventName(backupEvent.eventName),
          createdAt: backupEvent.createdAt,
          closedAt: backupEvent.closedAt,
          adminUsername: backupEvent.adminUsername,
          adminPasswordHash: backupEvent.adminPasswordHash,
          eventPasscode: backupEvent.eventPasscode,
          eventPasscodeHash: backupEvent.eventPasscodeHash,
        });
        created.push(event);
        this.writeEventData(event.dbFilePath, backupEvent.data);
      }
    } catch (error) {
      for (const event of created) {
        try {
          this.eventStore.deleteEvent(event.id);
        } catch {
          // Best-effort rollback; the original error is what matters.
        }
      }

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "EVENT_IMPORT_FAILED", "Failed to import event backup", error);
    }

    return created;
  }
}
