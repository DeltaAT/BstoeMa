import Database from "better-sqlite3";
import type {
  MenuItemStockRequirementDto,
  MenuItemStockRequirementsReplaceRequest,
  MenuItemStockRequirementsReplaceResponse,
  StockItemCreateRequest,
  StockItemDto,
  StockItemUpdateRequest,
} from "@bstoema/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type StockItemRow = {
  id: number;
  name: string;
  quantity: number;
};

type StockRequirementRow = {
  stockItemId: number;
  quantityRequired: number;
};

export class StockStore {
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
    this.ensureStockSchema(db);
    return db;
  }

  private ensureStockSchema(db: Database.Database) {
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

      CREATE TABLE IF NOT EXISTS StockItems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS StockItems_name_key ON StockItems(name);

      CREATE TABLE IF NOT EXISTS StockItemMenuItem (
        stockItem_id INTEGER NOT NULL,
        menuItem_id INTEGER NOT NULL,
        quantityRequired INTEGER NOT NULL,
        PRIMARY KEY (stockItem_id, menuItem_id)
      );

      CREATE INDEX IF NOT EXISTS StockItemMenuItem_menuItem_id_idx ON StockItemMenuItem(menuItem_id);
    `);
  }

  private mapDbError(error: unknown): never {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new ApiError(409, "STOCK_ITEM_ALREADY_EXISTS", "Stock item name already exists");
    }

    throw error;
  }

  private getStockItemRow(db: Database.Database, stockItemId: number) {
    return db
      .prepare(
        `
        SELECT id, name, quantity
        FROM StockItems
        WHERE id = ?
        `
      )
      .get(stockItemId) as StockItemRow | undefined;
  }

  private toStockItemDto(row: StockItemRow): StockItemDto {
    return {
      id: row.id,
      name: row.name,
      quantity: row.quantity,
    };
  }

  private assertMenuItemExists(db: Database.Database, menuItemId: number) {
    const row = db
      .prepare("SELECT id FROM MenuItems WHERE id = ?")
      .get(menuItemId) as { id: number } | undefined;

    if (!row) {
      throw new ApiError(404, "MENU_ITEM_NOT_FOUND", "Menu item not found");
    }
  }

  listItems(): StockItemDto[] {
    const db = this.openActiveEventDb();
    try {
      const rows = db
        .prepare(
          `
          SELECT id, name, quantity
          FROM StockItems
          ORDER BY name COLLATE NOCASE ASC
          `
        )
        .all() as StockItemRow[];

      return rows.map((row) => this.toStockItemDto(row));
    } finally {
      db.close();
    }
  }

  createItem(input: StockItemCreateRequest): StockItemDto {
    const db = this.openActiveEventDb();
    try {
      let result: Database.RunResult;
      try {
        result = db
          .prepare("INSERT INTO StockItems (name, quantity) VALUES (?, ?)")
          .run(input.name, input.quantity);
      } catch (error) {
        this.mapDbError(error);
      }

      const created = this.getStockItemRow(db, Number(result!.lastInsertRowid));
      if (!created) {
        throw new ApiError(500, "STOCK_ITEM_CREATE_FAILED", "Failed to create stock item");
      }

      return this.toStockItemDto(created);
    } finally {
      db.close();
    }
  }

  updateItem(stockItemId: number, input: StockItemUpdateRequest): StockItemDto {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getStockItemRow(db, stockItemId);
      if (!existing) {
        throw new ApiError(404, "STOCK_ITEM_NOT_FOUND", "Stock item not found");
      }

      const nextQuantity =
        input.quantity !== undefined ? input.quantity : existing.quantity + (input.delta ?? 0);
      if (nextQuantity < 0) {
        throw new ApiError(
          400,
          "INVALID_STOCK_QUANTITY",
          "Resulting stock quantity must be zero or greater"
        );
      }

      db.prepare("UPDATE StockItems SET quantity = ? WHERE id = ?").run(nextQuantity, stockItemId);

      const updated = this.getStockItemRow(db, stockItemId);
      if (!updated) {
        throw new ApiError(500, "STOCK_ITEM_UPDATE_FAILED", "Failed to update stock item");
      }

      return this.toStockItemDto(updated);
    } finally {
      db.close();
    }
  }

  getMenuItemRequirements(menuItemId: number): MenuItemStockRequirementsReplaceResponse {
    const db = this.openActiveEventDb();
    try {
      this.assertMenuItemExists(db, menuItemId);

      const rows = db
        .prepare(
          `
          SELECT stockItem_id as stockItemId, quantityRequired
          FROM StockItemMenuItem
          WHERE menuItem_id = ?
          ORDER BY stockItem_id ASC
          `
        )
        .all(menuItemId) as StockRequirementRow[];

      return {
        menuItemId,
        requirements: rows.map((row) => ({
          stockItemId: row.stockItemId,
          quantityRequired: row.quantityRequired,
        })),
      };
    } finally {
      db.close();
    }
  }

  replaceMenuItemRequirements(
    menuItemId: number,
    input: MenuItemStockRequirementsReplaceRequest
  ): MenuItemStockRequirementsReplaceResponse {
    const db = this.openActiveEventDb();
    try {
      this.assertMenuItemExists(db, menuItemId);

      const dedupe = new Set<number>();
      for (const requirement of input.requirements) {
        if (dedupe.has(requirement.stockItemId)) {
          throw new ApiError(
            400,
            "DUPLICATE_STOCK_REQUIREMENT",
            "Each stockItemId may only appear once"
          );
        }
        dedupe.add(requirement.stockItemId);
      }

      if (input.requirements.length > 0) {
        const stockItemIds = input.requirements.map((requirement) => requirement.stockItemId);
        const placeholders = stockItemIds.map(() => "?").join(", ");
        const existingRows = db
          .prepare(`SELECT id FROM StockItems WHERE id IN (${placeholders})`)
          .all(...stockItemIds) as Array<{ id: number }>;

        const existingIds = new Set(existingRows.map((row) => row.id));
        const missingStockItemIds = stockItemIds.filter((id) => !existingIds.has(id));
        if (missingStockItemIds.length > 0) {
          throw new ApiError(404, "STOCK_ITEM_NOT_FOUND", "One or more stock items were not found", {
            missingStockItemIds,
          });
        }
      }

      const removeRequirements = db.prepare(
        "DELETE FROM StockItemMenuItem WHERE menuItem_id = ?"
      );
      const insertRequirement = db.prepare(
        "INSERT INTO StockItemMenuItem (stockItem_id, menuItem_id, quantityRequired) VALUES (?, ?, ?)"
      );
      const transaction = db.transaction(() => {
        removeRequirements.run(menuItemId);
        for (const requirement of input.requirements) {
          insertRequirement.run(requirement.stockItemId, menuItemId, requirement.quantityRequired);
        }
      });
      transaction();

      const rows = db
        .prepare(
          `
          SELECT stockItem_id as stockItemId, quantityRequired
          FROM StockItemMenuItem
          WHERE menuItem_id = ?
          ORDER BY stockItem_id ASC
          `
        )
        .all(menuItemId) as StockRequirementRow[];

      const requirements: MenuItemStockRequirementDto[] = rows.map((row) => ({
        stockItemId: row.stockItemId,
        quantityRequired: row.quantityRequired,
      }));

      return {
        menuItemId,
        requirements,
      };
    } finally {
      db.close();
    }
  }
}

