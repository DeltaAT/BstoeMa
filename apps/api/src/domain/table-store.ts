import Database from "better-sqlite3";
import type {
  TableBulkCreateRequest,
  TableCreateRequest,
  TableDto,
  TableUpdateRequest,
} from "@serva/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type ListTablesInput = {
  locked?: boolean;
};

type TableRow = {
  id: number;
  name: string;
  weight: number;
  isLocked: number;
};

export class TableStore {
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
    this.ensureTablesSchema(db);
    return db;
  }

  private ensureTablesSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 0,
        isLocked INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Tables_name_key ON Tables(name);
    `);
  }

  private toTableDto(row: TableRow): TableDto {
    return {
      id: row.id,
      name: row.name,
      weight: row.weight,
      isLocked: row.isLocked === 1,
    };
  }

  private getTableRow(db: Database.Database, tableId: number) {
    return db
      .prepare(
        `
        SELECT id, name, weight, isLocked
        FROM Tables
        WHERE id = ?
        `
      )
      .get(tableId) as TableRow | undefined;
  }

  private mapDbError(error: unknown): never {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new ApiError(409, "TABLE_ALREADY_EXISTS", "Table name already exists");
    }

    throw error;
  }

  listTables(input: ListTablesInput): TableDto[] {
    const db = this.openActiveEventDb();
    try {
      const where: string[] = [];
      const params: Array<string | number> = [];

      if (input.locked !== undefined) {
        where.push("isLocked = ?");
        params.push(input.locked ? 1 : 0);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = db
        .prepare(
          `
          SELECT id, name, weight, isLocked
          FROM Tables
          ${whereClause}
          ORDER BY weight ASC, name COLLATE NOCASE ASC
          `
        )
        .all(...params) as TableRow[];

      return rows.map((row) => this.toTableDto(row));
    } finally {
      db.close();
    }
  }

  createTable(input: TableCreateRequest): TableDto {
    const db = this.openActiveEventDb();
    try {
      let result: Database.RunResult;
      try {
        result = db
          .prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)")
          .run(input.name, input.weight ?? 0, input.isLocked ? 1 : 0);
      } catch (error) {
        this.mapDbError(error);
      }

      const created = this.getTableRow(db, Number(result!.lastInsertRowid));
      if (!created) {
        throw new ApiError(500, "TABLE_CREATE_FAILED", "Failed to create table");
      }

      return this.toTableDto(created);
    } finally {
      db.close();
    }
  }

  createTablesBulk(input: TableBulkCreateRequest): TableDto[] {
    const db = this.openActiveEventDb();
    try {
      const names = input.rows.flatMap((row) => {
        const trimmed = row.trim();
        const rangeLength = input.to - input.from + 1;
        return Array.from({ length: rangeLength }, (_, index) => `${trimmed}${input.from + index}`);
      });

      const dedupe = new Set(names.map((name) => name.toLowerCase()));
      if (dedupe.size !== names.length) {
        throw new ApiError(409, "TABLE_ALREADY_EXISTS", "Table names in request must be unique");
      }

      // New tables go to the beginning of the list (lowest weight first), which
      // means below every existing table's weight. Slotting them at a fixed
      // 0..N-1 would collide with existing weights and scatter the batch once
      // the list is re-sorted by (weight, name). We reserve the N slots just
      // below the current minimum so the batch lands as a contiguous block at
      // the top, in the order it was requested — and each subsequent bulk add
      // stacks cleanly above the previous one. See issue #138.
      const { minWeight } = db
        .prepare("SELECT MIN(weight) AS minWeight FROM Tables")
        .get() as { minWeight: number | null };
      const baseWeight = (minWeight ?? 0) - names.length;

      const insert = db.prepare("INSERT INTO Tables (name, weight, isLocked) VALUES (?, ?, ?)");
      const transaction = db.transaction(() => {
        names.forEach((name, index) => {
          insert.run(name, baseWeight + index, input.lockNew ? 1 : 0);
        });
      });

      try {
        transaction();
      } catch (error) {
        this.mapDbError(error);
      }

      const placeholders = names.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `
          SELECT id, name, weight, isLocked
          FROM Tables
          WHERE name IN (${placeholders})
          ORDER BY weight ASC, name COLLATE NOCASE ASC
          `
        )
        .all(...names) as TableRow[];

      return rows.map((row) => this.toTableDto(row));
    } finally {
      db.close();
    }
  }

  updateTable(tableId: number, input: TableUpdateRequest): TableDto {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getTableRow(db, tableId);
      if (!existing) {
        throw new ApiError(404, "TABLE_NOT_FOUND", "Table not found");
      }

      try {
        db
          .prepare(
            `
            UPDATE Tables
            SET name = ?, weight = ?, isLocked = ?
            WHERE id = ?
            `
          )
          .run(
            input.name ?? existing.name,
            input.weight ?? existing.weight,
            input.isLocked === undefined ? existing.isLocked : input.isLocked ? 1 : 0,
            tableId
          );
      } catch (error) {
        this.mapDbError(error);
      }

      const updated = this.getTableRow(db, tableId);
      if (!updated) {
        throw new ApiError(500, "TABLE_UPDATE_FAILED", "Failed to update table");
      }

      return this.toTableDto(updated);
    } finally {
      db.close();
    }
  }

  getTable(tableId: number): TableDto {
    const db = this.openActiveEventDb();
    try {
      const table = this.getTableRow(db, tableId);
      if (!table) {
        throw new ApiError(404, "TABLE_NOT_FOUND", "Table not found");
      }

      return this.toTableDto(table);
    } finally {
      db.close();
    }
  }
}

