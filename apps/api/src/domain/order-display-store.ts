import Database from "better-sqlite3";
import type {
  OrderDisplayCreateRequest,
  OrderDisplayDto,
  OrderDisplayUpdateRequest,
} from "@bstoema/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type OrderDisplayRow = {
  id: number;
  name: string;
  ipAddress: string;
  connectionDetails: string;
};

export class OrderDisplayStore {
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
    this.ensureOrderDisplaySchema(db);
    return db;
  }

  private ensureOrderDisplaySchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS OrderDisplays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ipAddress TEXT NOT NULL,
        connectionDetails TEXT NOT NULL DEFAULT ''
      );

      CREATE UNIQUE INDEX IF NOT EXISTS OrderDisplays_name_key ON OrderDisplays(name);
    `);
  }

  private mapDbError(error: unknown): never {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new ApiError(
        409,
        "ORDER_DISPLAY_ALREADY_EXISTS",
        "Order display name already exists"
      );
    }

    throw error;
  }

  private toDto(row: OrderDisplayRow): OrderDisplayDto {
    return {
      id: row.id,
      name: row.name,
      ipAddress: row.ipAddress,
      connectionDetails: row.connectionDetails,
    };
  }

  private getRowById(db: Database.Database, orderDisplayId: number) {
    return db
      .prepare(
        `
        SELECT id, name, ipAddress, connectionDetails
        FROM OrderDisplays
        WHERE id = ?
        `
      )
      .get(orderDisplayId) as OrderDisplayRow | undefined;
  }

  listOrderDisplays(): OrderDisplayDto[] {
    const db = this.openActiveEventDb();
    try {
      const rows = db
        .prepare(
          `
          SELECT id, name, ipAddress, connectionDetails
          FROM OrderDisplays
          ORDER BY name COLLATE NOCASE ASC
          `
        )
        .all() as OrderDisplayRow[];
      return rows.map((row) => this.toDto(row));
    } finally {
      db.close();
    }
  }

  getOrderDisplay(orderDisplayId: number): OrderDisplayDto {
    const db = this.openActiveEventDb();
    try {
      const row = this.getRowById(db, orderDisplayId);
      if (!row) {
        throw new ApiError(404, "ORDER_DISPLAY_NOT_FOUND", "Order display not found");
      }

      return this.toDto(row);
    } finally {
      db.close();
    }
  }

  createOrderDisplay(input: OrderDisplayCreateRequest): OrderDisplayDto {
    const db = this.openActiveEventDb();
    try {
      let result: Database.RunResult;
      try {
        result = db
          .prepare(
            "INSERT INTO OrderDisplays (name, ipAddress, connectionDetails) VALUES (?, ?, ?)"
          )
          .run(input.name, input.ipAddress, input.connectionDetails ?? "");
      } catch (error) {
        this.mapDbError(error);
      }

      const created = this.getRowById(db, Number(result!.lastInsertRowid));
      if (!created) {
        throw new ApiError(
          500,
          "ORDER_DISPLAY_CREATE_FAILED",
          "Failed to create order display"
        );
      }

      return this.toDto(created);
    } finally {
      db.close();
    }
  }

  updateOrderDisplay(
    orderDisplayId: number,
    input: OrderDisplayUpdateRequest
  ): OrderDisplayDto {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getRowById(db, orderDisplayId);
      if (!existing) {
        throw new ApiError(404, "ORDER_DISPLAY_NOT_FOUND", "Order display not found");
      }

      try {
        db
          .prepare(
            `
            UPDATE OrderDisplays
            SET name = ?, ipAddress = ?, connectionDetails = ?
            WHERE id = ?
            `
          )
          .run(
            input.name ?? existing.name,
            input.ipAddress ?? existing.ipAddress,
            input.connectionDetails ?? existing.connectionDetails,
            orderDisplayId
          );
      } catch (error) {
        this.mapDbError(error);
      }

      const updated = this.getRowById(db, orderDisplayId);
      if (!updated) {
        throw new ApiError(
          500,
          "ORDER_DISPLAY_UPDATE_FAILED",
          "Failed to update order display"
        );
      }

      return this.toDto(updated);
    } finally {
      db.close();
    }
  }

  deleteOrderDisplay(orderDisplayId: number): void {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getRowById(db, orderDisplayId);
      if (!existing) {
        throw new ApiError(404, "ORDER_DISPLAY_NOT_FOUND", "Order display not found");
      }

      // Mirrors PrinterStore: a display still wired to a category cannot be
      // deleted — the admin must reassign or unset routing first.
      const usage = db
        .prepare("SELECT COUNT(*) as count FROM MenuCategories WHERE orderDisplay_id = ?")
        .get(orderDisplayId) as { count: number };
      if (usage.count > 0) {
        throw new ApiError(
          409,
          "ORDER_DISPLAY_IN_USE",
          "Cannot delete order display while it is assigned to menu categories"
        );
      }

      db.prepare("DELETE FROM OrderDisplays WHERE id = ?").run(orderDisplayId);
    } finally {
      db.close();
    }
  }
}
