import Database from "better-sqlite3";
import type { UserCreateRequest, UserDto, UserUpdateRequest } from "@bstoema/shared-types";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type ListUsersInput = {
  locked?: boolean;
  search?: string;
};

type UserRow = {
  id: number;
  username: string;
  isLocked: number;
};

export class UserStore {
  constructor(private readonly eventStore: EventStore) {}

  private ensureUsersSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        isLocked INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Users_username_key ON Users(username);
    `);
  }

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
    this.ensureUsersSchema(db);
    return db;
  }

  private openEventDb(eventId: number) {
    const event = this.eventStore.getEvent(eventId);
    if (!event) {
      throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
    }

    const db = new Database(event.dbFilePath);
    this.ensureUsersSchema(db);
    return db;
  }

  private toUserDto(row: UserRow): UserDto {
    return {
      id: row.id,
      username: row.username,
      isLocked: row.isLocked === 1,
    };
  }

  private getUserRowById(db: Database.Database, userId: number) {
    return db
      .prepare(
        `
        SELECT id, username, isLocked
        FROM Users
        WHERE id = ?
        `
      )
      .get(userId) as UserRow | undefined;
  }

  private getUserRowByUsername(db: Database.Database, username: string) {
    return db
      .prepare(
        `
        SELECT id, username, isLocked
        FROM Users
        WHERE username = ?
        `
      )
      .get(username) as UserRow | undefined;
  }

  private mapDbError(error: unknown): never {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new ApiError(409, "USER_ALREADY_EXISTS", "Username already exists");
    }

    throw error;
  }

  listUsers(input: ListUsersInput): UserDto[] {
    const db = this.openActiveEventDb();
    try {
      const where: string[] = [];
      const params: Array<string | number> = [];

      if (input.locked !== undefined) {
        where.push("isLocked = ?");
        params.push(input.locked ? 1 : 0);
      }

      if (input.search) {
        where.push("username LIKE ? COLLATE NOCASE");
        params.push(`%${input.search}%`);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = db
        .prepare(
          `
            SELECT id, username, isLocked
            FROM Users ${whereClause}
            ORDER BY username COLLATE NOCASE
          `
        )
        .all(...params) as UserRow[];

      return rows.map((row) => this.toUserDto(row));
    } finally {
      db.close();
    }
  }

  createUser(input: UserCreateRequest): UserDto {
    const db = this.openActiveEventDb();
    try {
      let result: Database.RunResult;
      try {
        result = db
          .prepare("INSERT INTO Users (username, isLocked) VALUES (?, ?)")
          .run(input.username, input.isLocked ? 1 : 0);
      } catch (error) {
        this.mapDbError(error);
      }

      const created = this.getUserRowById(db, Number(result!.lastInsertRowid));
      if (!created) {
        throw new ApiError(500, "USER_CREATE_FAILED", "Failed to create user");
      }

      return this.toUserDto(created);
    } finally {
      db.close();
    }
  }

  getUser(userId: number): UserDto {
    const db = this.openActiveEventDb();
    try {
      const user = this.getUserRowById(db, userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "User not found");
      }

      return this.toUserDto(user);
    } finally {
      db.close();
    }
  }

  updateUser(userId: number, input: UserUpdateRequest): UserDto {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getUserRowById(db, userId);
      if (!existing) {
        throw new ApiError(404, "USER_NOT_FOUND", "User not found");
      }

      try {
        db
          .prepare(
            `
            UPDATE Users
            SET username = ?, isLocked = ?
            WHERE id = ?
            `
          )
          .run(
            input.username ?? existing.username,
            input.isLocked === undefined ? existing.isLocked : input.isLocked ? 1 : 0,
            userId
          );
      } catch (error) {
        this.mapDbError(error);
      }

      const updated = this.getUserRowById(db, userId);
      if (!updated) {
        throw new ApiError(500, "USER_UPDATE_FAILED", "Failed to update user");
      }

      return this.toUserDto(updated);
    } finally {
      db.close();
    }
  }

  deleteUser(userId: number): void {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getUserRowById(db, userId);
      if (!existing) {
        throw new ApiError(404, "USER_NOT_FOUND", "User not found");
      }

      db.prepare("DELETE FROM Users WHERE id = ?").run(userId);
    } finally {
      db.close();
    }
  }

  getOrCreateUserForEvent(eventId: number, username: string): UserDto {
    const db = this.openEventDb(eventId);
    try {
      const existing = this.getUserRowByUsername(db, username);
      if (existing) {
        return this.toUserDto(existing);
      }

      const created = db
        .prepare("INSERT INTO Users (username, isLocked) VALUES (?, 0)")
        .run(username);

      const user = this.getUserRowById(db, Number(created.lastInsertRowid));
      if (!user) {
        throw new ApiError(500, "USER_CREATE_FAILED", "Failed to create user");
      }

      return this.toUserDto(user);
    } finally {
      db.close();
    }
  }

  getUserForEventByUsername(eventId: number, username: string): UserDto | null {
    const db = this.openEventDb(eventId);
    try {
      const row = this.getUserRowByUsername(db, username);
      return row ? this.toUserDto(row) : null;
    } finally {
      db.close();
    }
  }
}

