import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "@serva/auth-context";
import type { TokenStorage } from "@serva/auth-context";
import App from "./App";

// ---------------------------------------------------------------------------
// Tauri secure-store adapter
//
// Uses the Tauri store plugin for encrypted, on-disk persistence.
// Falls back to a no-op in-memory store if the plugin isn't available
// (e.g. during browser-based dev without the Tauri shell).
// ---------------------------------------------------------------------------

class TauriTokenStorage implements TokenStorage {
  private memoryFallback: string | null = null;
  private readonly key = "serva_access_token";

  getToken(): string | null {
    // Tauri store access is async — on startup we hydrate synchronously from
    // memory and let AuthProvider's /auth/me check handle the real validation.
    return this.memoryFallback;
  }

  setToken(token: string): void {
    this.memoryFallback = token;
    // Persist to Tauri store asynchronously (fire-and-forget)
    this.tauriSet(token);
  }

  removeToken(): void {
    this.memoryFallback = null;
    this.tauriRemove();
  }

  /** Call once at app boot to hydrate from the Tauri store into memory. */
  async hydrate(): Promise<void> {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("auth.json");
      const val = await store.get<string>(this.key);
      if (typeof val === "string") {
        this.memoryFallback = val;
      }
    } catch {
      // Not running in Tauri — keep memoryFallback as-is
    }
  }

  private async tauriSet(token: string): Promise<void> {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("auth.json");
      await store.set(this.key, token);
      await store.save();
    } catch {
      // Not in Tauri context
    }
  }

  private async tauriRemove(): Promise<void> {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("auth.json");
      await store.delete(this.key);
      await store.save();
    } catch {
      // Not in Tauri context
    }
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

const tokenStorage = new TauriTokenStorage();

// Hydrate the token from disk before rendering so the first render already
// has it in memory (AuthProvider will validate via /auth/me).
tokenStorage.hydrate().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AuthProvider
        baseUrl={API_BASE_URL}
        tokenStorage={tokenStorage}
        onLogout={() => {
          // TODO: wire up router navigation to /login once a router is added
          window.location.replace("/login");
        }}
      >
        <App />
      </AuthProvider>
    </React.StrictMode>,
  );
});

