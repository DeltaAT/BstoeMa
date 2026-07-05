import { Writable } from "node:stream";
import type { LogEntryDto, LogLevel } from "@bstoema/shared-types";

// Pino's numeric levels.
const LEVEL_NAMES: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

// Keys we strip from the captured pino payload before exposing it as the
// `context` map — they're either redundant (already promoted to top-level
// fields) or noisy boilerplate (pid/hostname).
const STRIPPED_KEYS = new Set([
  "level",
  "time",
  "msg",
  "pid",
  "hostname",
  "v",
]);

interface RawEntry {
  level?: number;
  time?: number;
  msg?: string;
  [key: string]: unknown;
}

export class LogBuffer {
  private readonly capacity: number;
  private readonly entries: LogEntryDto[] = [];
  private nextId = 1;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  push(raw: RawEntry): void {
    const levelNum = typeof raw.level === "number" ? raw.level : 30;
    const level = LEVEL_NAMES[levelNum] ?? "info";
    const timeMs = typeof raw.time === "number" ? raw.time : Date.now();

    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!STRIPPED_KEYS.has(key)) {
        context[key] = value;
      }
    }

    const entry: LogEntryDto = {
      id: this.nextId++,
      time: new Date(timeMs).toISOString(),
      level,
      msg: typeof raw.msg === "string" ? raw.msg : "",
      ...(Object.keys(context).length > 0 ? { context } : {}),
    };

    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  query(opts: { since?: number; minLevel?: LogLevel; limit?: number }): {
    entries: LogEntryDto[];
    lastId: number;
  } {
    const lastId = this.entries.length === 0
      ? 0
      : this.entries[this.entries.length - 1].id;

    const minRank = opts.minLevel ? rankOf(opts.minLevel) : 0;
    const limit = opts.limit ?? 500;

    const filtered: LogEntryDto[] = [];
    for (const entry of this.entries) {
      if (opts.since !== undefined && entry.id <= opts.since) continue;
      if (rankOf(entry.level) < minRank) continue;
      filtered.push(entry);
    }

    const sliced = filtered.length > limit ? filtered.slice(-limit) : filtered;
    return { entries: sliced, lastId };
  }
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function rankOf(level: LogLevel): number {
  return LEVEL_RANK[level] ?? 30;
}

/**
 * Creates a Writable stream suitable as Fastify's `logger.stream`. Each chunk
 * is one pino JSON log line; we parse it into a ring-buffer entry and also
 * forward the raw line to stdout so console output remains intact.
 */
export function createLogBufferStream(buffer: LogBuffer): Writable {
  return new Writable({
    write(chunk, _enc, cb) {
      const line = chunk.toString();
      process.stdout.write(line);
      // pino batches multiple log records by newline; handle each separately.
      for (const part of line.split("\n")) {
        if (!part) continue;
        try {
          buffer.push(JSON.parse(part) as RawEntry);
        } catch {
          // Non-JSON output (shouldn't happen from pino) — skip silently.
        }
      }
      cb();
    },
  });
}

export const logBuffer = new LogBuffer();
