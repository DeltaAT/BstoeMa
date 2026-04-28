/**
 * Abstract interface for token persistence.
 *
 * waiter-web  → LocalStorageTokenStorage (below)
 * admin-desktop → Tauri secure-store adapter (provided by the app)
 */
export interface TokenStorage {
  getToken(): string | null;
  setToken(token: string): void;
  removeToken(): void;
}

// ---------------------------------------------------------------------------
// Built-in: plain localStorage (suitable for waiter-web)
// ---------------------------------------------------------------------------

const DEFAULT_KEY = "serva_access_token";

export class LocalStorageTokenStorage implements TokenStorage {
  private readonly key: string;

  constructor(key = DEFAULT_KEY) {
    this.key = key;
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
}
