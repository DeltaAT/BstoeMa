import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { ApiError } from "./api-error";
import { hashPassword, verifyPassword } from "./password";

export type EventRecord = {
  id: number;
  eventName: string;
  adminUsername: string;
  isActive: boolean;
  createdAt: string;
  closedAt?: string;
  dbFilePath: string;
};

export class EventStore {
  private readonly controlDb: Database.Database;
  private readonly eventsDir: string;

  constructor(baseDir = resolve(process.cwd(), "data")) {
    mkdirSync(baseDir, { recursive: true });
    this.eventsDir = join(baseDir, "events");
    mkdirSync(this.eventsDir, { recursive: true });

    const controlPath = join(baseDir, "control.db");
    this.controlDb = new Database(controlPath);
    this.initializeControlSchema();
  }

  private initializeControlSchema() {
    this.controlDb.exec(`
      CREATE TABLE IF NOT EXISTS Events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventName TEXT NOT NULL UNIQUE,
        eventPasscodeHash TEXT NOT NULL,
        adminUsername TEXT NOT NULL,
        adminPasswordHash TEXT NOT NULL,
        dbFilePath TEXT NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        closedAt TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Events_single_active_idx
        ON Events(isActive)
        WHERE isActive = 1;
    `);

    // Migration: add plaintext passcode column for display/rotation feature.
    // SQLite has no IF NOT EXISTS for ALTER TABLE — catch the error instead.
    try {
      this.controlDb.exec(`ALTER TABLE Events ADD COLUMN eventPasscode TEXT`);
    } catch {
      // Column already exists; nothing to do.
    }
  }

  private mapEventRow(row: {
    id: number;
    eventName: string;
    adminUsername: string;
    isActive: number;
    createdAt: string;
    closedAt: string | null;
    dbFilePath: string;
  }): EventRecord {
    return {
      id: row.id,
      eventName: row.eventName,
      adminUsername: row.adminUsername,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      closedAt: row.closedAt ?? undefined,
      dbFilePath: row.dbFilePath,
    };
  }

  private createEventDatabase(eventId: number) {
    const dbPath = join(this.eventsDir, `event-${eventId}.db`);
    mkdirSync(dirname(dbPath), { recursive: true });
    const eventDb = new Database(dbPath);
    eventDb.exec(`
      CREATE TABLE IF NOT EXISTS EventMeta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        eventId INTEGER NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
    eventDb.prepare("INSERT OR IGNORE INTO EventMeta (id, eventId, createdAt) VALUES (1, ?, ?)").run(eventId, new Date().toISOString());
    eventDb.close();
    return dbPath;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    );
  }

  createEvent(input: {
    eventName: string;
    eventPasscode: string;
    adminUsername: string;
    adminPassword: string;
  }) {
    const now = new Date().toISOString();
    const insert = this.controlDb.prepare(
      `
      INSERT INTO Events (eventName, eventPasscode, eventPasscodeHash, adminUsername, adminPasswordHash, dbFilePath, isActive, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `
    );

    let eventId: number | null = null;
    let dbFilePath: string | null = null;
    let created: EventRecord | null = null;

    try {
      const result = insert.run(
        input.eventName,
        input.eventPasscode,
        hashPassword(input.eventPasscode),
        input.adminUsername,
        hashPassword(input.adminPassword),
        "",
        now
      );

      eventId = Number(result.lastInsertRowid);
      dbFilePath = this.createEventDatabase(eventId);
      this.controlDb
        .prepare("UPDATE Events SET dbFilePath = ? WHERE id = ?")
        .run(dbFilePath, eventId);

      created = this.getEvent(eventId);
    } catch (error) {
      if (eventId !== null) {
        try {
          if (dbFilePath) {
            rmSync(dbFilePath, { force: true });
          }
        } catch {
          // Ignore cleanup errors here; the control row is removed below if it exists.
        }

        try {
          this.controlDb.prepare("DELETE FROM Events WHERE id = ?").run(eventId);
        } catch {
          // Ignore cleanup errors; the original error will be reported below.
        }
      }

      if (this.isUniqueConstraintError(error)) {
        throw new ApiError(409, "EVENT_ALREADY_EXISTS", "Event name already exists");
      }

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "EVENT_CREATE_FAILED", "Failed to create event", error);
    }

    if (!created) {
      if (eventId !== null) {
        try {
          if (dbFilePath) {
            rmSync(dbFilePath, { force: true });
          }
        } catch {
          // Ignore cleanup errors here; the control row is removed below if it exists.
        }

        try {
          this.controlDb.prepare("DELETE FROM Events WHERE id = ?").run(eventId);
        } catch {
          // Ignore cleanup errors; the caller still receives a deterministic failure.
        }
      }

      throw new ApiError(500, "EVENT_CREATE_FAILED", "Failed to load created event");
    }

    return created;
  }

  listAllEvents(): EventRecord[] {
    const rows = this.controlDb
      .prepare(
        "SELECT id, eventName, adminUsername, isActive, createdAt, closedAt, dbFilePath FROM Events ORDER BY id DESC"
      )
      .all() as {
        id: number;
        eventName: string;
        adminUsername: string;
        isActive: number;
        createdAt: string;
        closedAt: string | null;
        dbFilePath: string;
      }[];
    return rows.map((r) => this.mapEventRow(r));
  }

  getEvent(eventId: number) {
    const row = this.controlDb
      .prepare(
        "SELECT id, eventName, adminUsername, isActive, createdAt, closedAt, dbFilePath FROM Events WHERE id = ?"
      )
      .get(eventId) as
      | {
          id: number;
          eventName: string;
          adminUsername: string;
          isActive: number;
          createdAt: string;
          closedAt: string | null;
          dbFilePath: string;
        }
      | undefined;

    return row ? this.mapEventRow(row) : null;
  }

  getActiveEvent() {
    const row = this.controlDb
      .prepare(
        "SELECT id, eventName, adminUsername, isActive, createdAt, closedAt, dbFilePath FROM Events WHERE isActive = 1 LIMIT 1"
      )
      .get() as
      | {
          id: number;
          eventName: string;
          adminUsername: string;
          isActive: number;
          createdAt: string;
          closedAt: string | null;
          dbFilePath: string;
        }
      | undefined;

    return row ? this.mapEventRow(row) : null;
  }

  activateEvent(eventId: number) {
    const target = this.getEvent(eventId);
    if (!target) {
      throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    if (target.closedAt) {
      throw new ApiError(409, "EVENT_CLOSED", "Closed event cannot be activated");
    }

    this.controlDb.transaction(() => {
      this.controlDb.prepare("UPDATE Events SET isActive = 0 WHERE isActive = 1").run();
      this.controlDb.prepare("UPDATE Events SET isActive = 1 WHERE id = ?").run(eventId);
    })();

    return this.getEvent(eventId) as EventRecord;
  }

  deactivateEvent(eventId: number) {
    const target = this.getEvent(eventId);
    if (!target) {
      throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    if (target.closedAt) {
      throw new ApiError(409, "EVENT_CLOSED", "Closed event cannot be deactivated");
    }

    this.controlDb.prepare("UPDATE Events SET isActive = 0 WHERE id = ?").run(eventId);
    return this.getEvent(eventId) as EventRecord;
  }

  closeEvent(eventId: number) {
    const target = this.getEvent(eventId);
    if (!target) {
      throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    if (target.closedAt) {
      throw new ApiError(409, "EVENT_CLOSED", "Closed event cannot be closed again");
    }

    const closedAt = new Date().toISOString();
    this.controlDb.transaction(() => {
      this.controlDb
        .prepare("UPDATE Events SET isActive = 0, closedAt = ? WHERE id = ?")
        .run(closedAt, eventId);
    })();
    return this.getEvent(eventId) as EventRecord;
  }

  deleteEvent(eventId: number) {
    const target = this.getEvent(eventId);
    if (!target) {
      throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    try {
      this.controlDb.transaction(() => {
        this.controlDb.prepare("DELETE FROM Events WHERE id = ?").run(eventId);
        rmSync(target.dbFilePath, { force: true });
      })();
    } catch (error) {
      throw new ApiError(500, "EVENT_DELETE_FAILED", "Failed to delete event database file", error);
    }
  }

  /**
   * Returns the plaintext passcode of the active event, or null if the event
   * predates the passcode-display migration and has not yet been rotated.
   * Throws NO_ACTIVE_EVENT if no event is currently active.
   */
  getActiveEventPasscode(): string | null {
    const row = this.controlDb
      .prepare("SELECT eventPasscode FROM Events WHERE isActive = 1 LIMIT 1")
      .get() as { eventPasscode: string | null } | undefined;

    if (!row) {
      throw new ApiError(409, "NO_ACTIVE_EVENT", "No active event exists. Activate an event first.");
    }

    return row.eventPasscode;
  }

  /**
   * Updates the passcode (plaintext + hash) for the currently active event.
   * Returns the new plaintext passcode.
   * Throws NO_ACTIVE_EVENT if no event is active.
   */
  rotateActiveEventPasscode(newPasscode: string): string {
    const row = this.controlDb
      .prepare("SELECT id FROM Events WHERE isActive = 1 LIMIT 1")
      .get() as { id: number } | undefined;

    if (!row) {
      throw new ApiError(409, "NO_ACTIVE_EVENT", "No active event exists. Activate an event first.");
    }

    this.controlDb
      .prepare("UPDATE Events SET eventPasscode = ?, eventPasscodeHash = ? WHERE id = ?")
      .run(newPasscode, hashPassword(newPasscode), row.id);

    return newPasscode;
  }

  verifyActiveEventPasscode(eventPasscode: string) {
    const row = this.controlDb
      .prepare("SELECT id, eventPasscodeHash FROM Events WHERE isActive = 1 LIMIT 1")
      .get() as { id: number; eventPasscodeHash: string } | undefined;

    if (!row) {
      throw new ApiError(409, "NO_ACTIVE_EVENT", "No active event exists. Activate an event first.");
    }

    if (!verifyPassword(eventPasscode, row.eventPasscodeHash)) {
      throw new ApiError(401, "INVALID_EVENT_PASSCODE", "Invalid event passcode");
    }

    return row.id;
  }

  verifyEventAdminCredentials(eventId: number, username: string, password: string) {
    const row = this.controlDb
      .prepare("SELECT adminUsername, adminPasswordHash, closedAt FROM Events WHERE id = ?")
      .get(eventId) as
      | { adminUsername: string; adminPasswordHash: string; closedAt: string | null }
      | undefined;

    if (!row) {
      throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    if (row.closedAt) {
      throw new ApiError(409, "EVENT_CLOSED", "Closed event cannot be used for admin login");
    }

    if (row.adminUsername !== username || !verifyPassword(password, row.adminPasswordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid admin credentials");
    }
  }
}

