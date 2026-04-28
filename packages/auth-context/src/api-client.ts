import type { TokenStorage } from "./token-storage.js";

// ---------------------------------------------------------------------------
// Tiny event bus so AuthProvider can listen for 401s without coupling
// ---------------------------------------------------------------------------

type Listener = () => void;

class AuthEventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }
}

export const unauthorizedBus = new AuthEventBus();

// ---------------------------------------------------------------------------
// API client — wraps fetch, attaches token, fires on 401
// ---------------------------------------------------------------------------

export interface ApiClientOptions {
  /** Base URL of the Serva API, e.g. "http://192.168.1.10:3000" */
  baseUrl: string;
  tokenStorage: TokenStorage;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokenStorage: TokenStorage;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.tokenStorage = opts.tokenStorage;
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = this.tokenStorage.getToken();
    const headers = new Headers(init.headers);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (
      !headers.has("Content-Type") &&
      init.body &&
      typeof init.body === "string"
    ) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (res.status === 401) {
      unauthorizedBus.emit();
      throw new ApiError(401, "UNAUTHORIZED", "Session expired or invalid");
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const code = body?.error?.code ?? "UNKNOWN";
      const message = body?.error?.message ?? res.statusText;
      throw new ApiError(res.status, code, message);
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
