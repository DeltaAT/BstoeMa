/** Waiter re-login credentials, persisted so the session can be silently
 *  renewed after the access token expires (no individual password — waiters
 *  authenticate with their username plus the shared event passcode). */
export interface WaiterCredentials {
  username: string;
  eventPasscode: string;
}

/**
 * Abstract interface for token persistence.
 *
 * waiter-web  → LocalStorageTokenStorage (below)
 * admin-desktop → Tauri secure-store adapter (provided by the app)
 *
 * The `*WaiterCredentials` methods are optional: platforms that support silent
 * waiter session renewal implement them; others (e.g. the admin desktop, which
 * has no waiter flow) can omit them.
 */
export interface TokenStorage {
  getToken(): string | null;
  setToken(token: string): void;
  removeToken(): void;
  getWaiterCredentials?(): WaiterCredentials | null;
  setWaiterCredentials?(credentials: WaiterCredentials): void;
  removeWaiterCredentials?(): void;
}

// ---------------------------------------------------------------------------
// Built-in: plain localStorage (suitable for waiter-web)
// ---------------------------------------------------------------------------

// Storage keys keep the legacy "serva" prefix so existing sessions survive
// the BstöMa rebrand.
const DEFAULT_KEY = "serva_access_token";
const DEFAULT_CREDENTIALS_KEY = "serva_waiter_credentials";

export class LocalStorageTokenStorage implements TokenStorage {
  private readonly key: string;
  private readonly credentialsKey: string;

  constructor(key = DEFAULT_KEY, credentialsKey = DEFAULT_CREDENTIALS_KEY) {
    this.key = key;
    this.credentialsKey = credentialsKey;
  }

  getToken(): string | null {
    try {
      return localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  setToken(token: string): void {
    try {
      localStorage.setItem(this.key, token);
    } catch {
      // SSR or restricted context — silently ignore
    }
  }

  removeToken(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // SSR or restricted context — silently ignore
    }
  }

  getWaiterCredentials(): WaiterCredentials | null {
    try {
      const raw = localStorage.getItem(this.credentialsKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<WaiterCredentials>;
      if (
        typeof parsed?.username === "string" &&
        typeof parsed?.eventPasscode === "string"
      ) {
        return { username: parsed.username, eventPasscode: parsed.eventPasscode };
      }
      return null;
    } catch {
      return null;
    }
  }

  setWaiterCredentials(credentials: WaiterCredentials): void {
    try {
      localStorage.setItem(this.credentialsKey, JSON.stringify(credentials));
    } catch {
      // SSR or restricted context — silently ignore
    }
  }

  removeWaiterCredentials(): void {
    try {
      localStorage.removeItem(this.credentialsKey);
    } catch {
      // SSR or restricted context — silently ignore
    }
  }
}
