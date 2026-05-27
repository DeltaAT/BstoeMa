import Database from "better-sqlite3";
import type {
  AnnouncementCreateRequest,
  AnnouncementDto,
  AnnouncementsQuery,
} from "@serva/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type AnnouncementRow = {
  id: number;
  message: string;
  severity: string;
  createdAt: string;
  createdBy: string;
};

export class AnnouncementStore {
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
    this.ensureSchema(db);
    return db;
  }

  private ensureSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        createdAt TEXT NOT NULL,
        createdBy TEXT NOT NULL
      );
    `);
  }

  private toDto(row: AnnouncementRow): AnnouncementDto {
    return {
      id: row.id,
      message: row.message,
      severity: row.severity as AnnouncementDto["severity"],
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  list(query: AnnouncementsQuery): AnnouncementDto[] {
    const db = this.openActiveEventDb();
    try {
      if (query.since != null) {
        const rows = db
          .prepare(
            "SELECT id, message, severity, createdAt, createdBy FROM Announcements WHERE id > ? ORDER BY id ASC"
          )
          .all(query.since) as AnnouncementRow[];
        return rows.map((r) => this.toDto(r));
      }

      const rows = db
        .prepare(
          "SELECT id, message, severity, createdAt, createdBy FROM Announcements ORDER BY id DESC LIMIT 100"
        )
        .all() as AnnouncementRow[];
      return rows.map((r) => this.toDto(r));
    } finally {
      db.close();
    }
  }

  create(input: AnnouncementCreateRequest, createdBy: string): AnnouncementDto {
    const db = this.openActiveEventDb();
    try {
      const now = new Date().toISOString();
      const severity = input.severity ?? "info";

      const result = db
        .prepare(
          "INSERT INTO Announcements (message, severity, createdAt, createdBy) VALUES (?, ?, ?, ?)"
        )
        .run(input.message, severity, now, createdBy);

      const row = db
        .prepare(
          "SELECT id, message, severity, createdAt, createdBy FROM Announcements WHERE id = ?"
        )
        .get(Number(result.lastInsertRowid)) as AnnouncementRow | undefined;

      if (!row) {
        throw new ApiError(500, "ANNOUNCEMENT_CREATE_FAILED", "Failed to create announcement");
      }

      return this.toDto(row);
    } finally {
      db.close();
    }
  }
}
