import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * File-backed master credentials for the bundled desktop app, which ships with
 * no MASTER_* env vars. The operator sets them once via the first-run setup
 * screen; the password is stored only as a scrypt hash (never plaintext).
 *
 * In dev/tests the MASTER_USERNAME/MASTER_PASSWORD env vars take precedence and
 * this store is never touched — see AuthStore.
 */
interface StoredCredentials {
  username: string;
  salt: string; // hex
  hash: string; // hex
}

const KEY_LEN = 64;

export class MasterCredentialsStore {
  private readonly filePath: string;

  constructor(baseDir = resolve(process.cwd(), "data")) {
    this.filePath = join(baseDir, "master-credentials.json");
  }

  hasCredentials(): boolean {
    return existsSync(this.filePath);
  }

  create(username: string, password: string): void {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, KEY_LEN);
    const record: StoredCredentials = {
      username,
      salt: salt.toString("hex"),
      hash: hash.toString("hex"),
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(record, null, 2));
  }

  verify(username: string, password: string): boolean {
    if (!this.hasCredentials()) return false;
    let record: StoredCredentials;
    try {
      record = JSON.parse(readFileSync(this.filePath, "utf8")) as StoredCredentials;
    } catch {
      return false;
    }
    if (record.username !== username) return false;
    const expected = Buffer.from(record.hash, "hex");
    const actual = scryptSync(password, Buffer.from(record.salt, "hex"), KEY_LEN);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
