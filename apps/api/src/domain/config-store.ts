import Database from "better-sqlite3";
import type { ConfigPatchRequest, ConfigValues } from "@bstoema/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type ConfigRow = {
  name: string;
  value: string;
};

export class ConfigStore {
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
    this.ensureConfigurationsSchema(db);
    return db;
  }

  private ensureConfigurationsSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Configurations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Configurations_name_key ON Configurations(name);
    `);
  }

  listValues(): ConfigValues {
    const db = this.openActiveEventDb();
    try {
      const rows = db
        .prepare(
          `
          SELECT name, value
          FROM Configurations
          ORDER BY name COLLATE NOCASE ASC
          `
        )
        .all() as ConfigRow[];

      const values: ConfigValues = {};
      for (const row of rows) {
        values[row.name] = row.value;
      }

      return values;
    } finally {
      db.close();
    }
  }

  patchValues(input: ConfigPatchRequest): ConfigValues {
    const db = this.openActiveEventDb();
    try {
      const upsert = db.prepare(
        `
        INSERT INTO Configurations (name, value)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET value = excluded.value
        `
      );

      const transaction = db.transaction(() => {
        for (const [name, value] of Object.entries(input.values)) {
          upsert.run(name, value);
        }
      });

      transaction();

      const rows = db
        .prepare(
          `
          SELECT name, value
          FROM Configurations
          ORDER BY name COLLATE NOCASE ASC
          `
        )
        .all() as ConfigRow[];

      const values: ConfigValues = {};
      for (const row of rows) {
        values[row.name] = row.value;
      }

      return values;
    } finally {
      db.close();
    }
  }
}

