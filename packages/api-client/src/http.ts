import {
  ApiAuthError,
  ApiClientError,
  ApiConflictError,
  ApiForbiddenError,
  ApiNoActiveEventError,
  ApiNotFoundError,
  ApiPrinterError,
  ApiValidationError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Duck-typed schema — compatible with any Zod schema. */
interface Schema<T> {
  safeParse(val: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
}

export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface HttpTransportOptions {
  baseUrl: string;
  /**
   * Return the current bearer token, or null when unauthenticated.
   * Called fresh on every request so token rotations are picked up automatically.
   */
  getToken: () => string | null;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function throwFromResponse(status: number, body: unknown): never {
  const env = body as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  const code = env?.error?.code ?? "UNKNOWN";
  const message = env?.error?.message ?? `HTTP ${status}`;
  const details = env?.error?.details;

  if (status === 401) throw new ApiAuthError(message, details);
  if (status === 403) throw new ApiForbiddenError(code, message, details);
  if (status === 404) throw new ApiNotFoundError(code, message, details);

  if (status === 409) {
    if (code === "NO_ACTIVE_EVENT") throw new ApiNoActiveEventError(message, details);
    if (code.startsWith("PRINTER_")) {
      const d = details as { target?: string; hint?: string } | undefined;
      throw new ApiPrinterError(code, message, d?.target, d?.hint, details);
    }
    throw new ApiConflictError(code, message, details);
  }

  if (status === 422) throw new ApiValidationError(message, details);

  throw new ApiClientError(status, code, message, details);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;

  constructor(opts: HttpTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.getToken = opts.getToken;
  }

  private buildUrl(path: string, query?: QueryParams): string {
    // When baseUrl is empty (same-origin via Vite proxy or production), the
    // path is relative (e.g. "/tables"). `new URL(relative)` throws in the
    // browser, so we supply `window.location.origin` as the fallback base.
    // When baseUrl is absolute (e.g. "http://localhost:8787"), it takes
    // precedence and the second argument is ignored.
    const base =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const url = new URL(`${this.baseUrl}${path}`, base);
    if (query) {
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }
    }
    return url.toString();
  }

  private authHeaders(): Headers {
    const headers = new Headers();
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  async request<T>(
    schema: Schema<T>,
    path: string,
    opts: { method?: string; body?: unknown; query?: QueryParams } = {},
  ): Promise<T> {
    const headers = this.authHeaders();
    let body: string | undefined;

    if (opts.body !== undefined && opts.body !== null) {
      body = JSON.stringify(opts.body);
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(this.buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body,
    });

    if (res.status === 204) return undefined as T;

    const json: unknown = await res.json().catch(() => null);

    if (!res.ok) throwFromResponse(res.status, json);

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiClientError(
        500,
        "RESPONSE_PARSE_ERROR",
        `Response from ${path} did not match expected shape`,
        parsed.error,
      );
    }
    return parsed.data;
  }

  get<T>(schema: Schema<T>, path: string, query?: QueryParams): Promise<T> {
    return this.request(schema, path, { method: "GET", query });
  }

  post<T>(schema: Schema<T>, path: string, body?: unknown): Promise<T> {
    return this.request(schema, path, { method: "POST", body });
  }

  patch<T>(schema: Schema<T>, path: string, body?: unknown): Promise<T> {
    return this.request(schema, path, { method: "PATCH", body });
  }

  put<T>(schema: Schema<T>, path: string, body?: unknown): Promise<T> {
    return this.request(schema, path, { method: "PUT", body });
  }

  async deleteVoid(path: string): Promise<void> {
    const res = await fetch(this.buildUrl(path), {
      method: "DELETE",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      throwFromResponse(res.status, json);
    }
  }

  async getText(path: string, query?: QueryParams): Promise<string> {
    const res = await fetch(this.buildUrl(path, query), {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      throwFromResponse(res.status, json);
    }
    return res.text();
  }

  async getBlob(path: string, query?: QueryParams): Promise<Blob> {
    const res = await fetch(this.buildUrl(path, query), {
      method: "GET",
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      throwFromResponse(res.status, json);
    }
    return res.blob();
  }

  async postBlob(path: string, body?: unknown): Promise<Blob> {
    const headers = this.authHeaders();
    let payload: string | undefined;
    if (body !== undefined && body !== null) {
      payload = JSON.stringify(body);
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(this.buildUrl(path), {
      method: "POST",
      headers,
      body: payload,
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => null);
      throwFromResponse(res.status, json);
    }
    return res.blob();
  }
}
