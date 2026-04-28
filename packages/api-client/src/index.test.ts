import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError,
  ApiConflictError,
  ApiNoActiveEventError,
  ApiNotFoundError,
  ApiPrinterError,
  ApiValidationError,
  createApiClient,
} from "./index.js";

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown> | null;

function mockFetch(status: number, body: JsonBody) {
  return Object.assign(
    async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => String(body),
      blob: async () => new Blob([JSON.stringify(body)]),
    }),
    // Satisfy the fetch function signature for TypeScript
    { preload: undefined },
  ) as unknown as typeof fetch;
}

function makeClient(status: number, body: JsonBody, token: string | null = null) {
  global.fetch = mockFetch(status, body);
  return createApiClient({ baseUrl: "http://localhost:8787", getToken: () => token });
}

// ---------------------------------------------------------------------------
// Happy-path: response is parsed and shaped correctly
// ---------------------------------------------------------------------------

test("auth.loginMaster returns typed response", async () => {
  const client = makeClient(200, {
    accessToken: "tok-abc",
    expiresInSeconds: 3600,
    role: "master",
  });

  const res = await client.auth.loginMaster({ username: "master", password: "secret" });

  assert.equal(res.accessToken, "tok-abc");
  assert.equal(res.role, "master");
  assert.equal(res.expiresInSeconds, 3600);
});

test("auth.loginWaiter returns typed response with user", async () => {
  const client = makeClient(200, {
    accessToken: "tok-waiter",
    expiresInSeconds: 3600,
    role: "waiter",
    eventId: 1,
    user: { id: 7, username: "anna", isLocked: false },
  });

  const res = await client.auth.loginWaiter({ username: "anna", eventPasscode: "party2024" });

  assert.equal(res.role, "waiter");
  assert.equal(res.user?.username, "anna");
  assert.equal(res.eventId, 1);
});

test("tables.list returns typed response", async () => {
  const client = makeClient(
    200,
    { tables: [{ id: 1, name: "A1", weight: 0, isLocked: false }] },
    "tok",
  );

  const res = await client.tables.list({ locked: false });

  assert.equal(res.tables.length, 1);
  assert.equal(res.tables[0].name, "A1");
});

test("menu.listCategories returns typed response", async () => {
  const client = makeClient(
    200,
    { categories: [{ id: 1, name: "Drinks", description: "", isLocked: false, weight: 0 }] },
    "tok",
  );

  const res = await client.menu.listCategories();
  assert.equal(res.categories[0].name, "Drinks");
});

test("printers.testPrint returns success payload", async () => {
  const client = makeClient(
    200,
    { ok: true, message: "Test print sent" },
    "tok",
  );

  const res = await client.printers.testPrint(1);
  assert.equal(res.ok, true);
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

test("401 → ApiAuthError", async () => {
  const client = makeClient(401, {
    error: { code: "UNAUTHORIZED", message: "Session expired" },
  });

  await assert.rejects(
    () => client.auth.me(),
    (err) => {
      assert(err instanceof ApiAuthError, `Expected ApiAuthError, got ${String(err)}`);
      assert.equal(err.status, 401);
      assert.equal(err.code, "UNAUTHORIZED");
      return true;
    },
  );
});

test("403 → ApiForbiddenError is not ApiAuthError", async () => {
  const { ApiForbiddenError } = await import("./errors.js");
  const client = makeClient(403, {
    error: { code: "FORBIDDEN", message: "Waiter role required" },
  });

  await assert.rejects(
    () => client.users.list(),
    (err) => {
      assert(err instanceof ApiForbiddenError, `Expected ApiForbiddenError, got ${String(err)}`);
      assert.equal(err.status, 403);
      return true;
    },
  );
});

test("404 → ApiNotFoundError", async () => {
  const client = makeClient(404, {
    error: { code: "TABLE_NOT_FOUND", message: "Table not found" },
  });

  await assert.rejects(
    () => client.tables.update(999, { name: "X" }),
    (err) => {
      assert(err instanceof ApiNotFoundError);
      assert.equal(err.code, "TABLE_NOT_FOUND");
      return true;
    },
  );
});

test("409 NO_ACTIVE_EVENT → ApiNoActiveEventError", async () => {
  const client = makeClient(409, {
    error: { code: "NO_ACTIVE_EVENT", message: "No active event" },
  });

  await assert.rejects(
    () => client.tables.list(),
    (err) => {
      assert(err instanceof ApiNoActiveEventError);
      assert.equal(err.code, "NO_ACTIVE_EVENT");
      return true;
    },
  );
});

test("409 PRINTER_* → ApiPrinterError with target and hint", async () => {
  const client = makeClient(409, {
    error: {
      code: "PRINTER_CONNECTION_FAILED",
      message: "Cannot reach printer",
      details: {
        target: "192.168.1.100:9100",
        hint: "Check that the printer is powered on and reachable on the network.",
      },
    },
  });

  await assert.rejects(
    () => client.printers.testPrint(1),
    (err) => {
      assert(err instanceof ApiPrinterError);
      assert.equal(err.code, "PRINTER_CONNECTION_FAILED");
      assert.equal(err.target, "192.168.1.100:9100");
      assert.ok(err.hint?.includes("powered on"));
      return true;
    },
  );
});

test("409 other code → ApiConflictError", async () => {
  const client = makeClient(409, {
    error: { code: "ALREADY_LOCKED", message: "Resource is locked" },
  });

  await assert.rejects(
    () => client.tables.create({ name: "B2" }),
    (err) => {
      assert(err instanceof ApiConflictError);
      assert.equal(err.code, "ALREADY_LOCKED");
      return true;
    },
  );
});

test("422 → ApiValidationError", async () => {
  const client = makeClient(422, {
    error: { code: "VALIDATION_ERROR", message: "Invalid body" },
  });

  // The client-side Zod parse would catch bad input before the network call,
  // but we can still simulate a server-side 422.
  global.fetch = mockFetch(422, {
    error: { code: "VALIDATION_ERROR", message: "price must be non-negative" },
  }) as typeof fetch;

  await assert.rejects(
    () =>
      // Bypass client-side validation by creating the client and using the raw http
      // transport directly via the public factory (simulates server-side failure).
      createApiClient({
        baseUrl: "http://localhost:8787",
        getToken: () => "tok",
      }).menu.createItem({ name: "X", price: 1, menuCategoryId: 1 }),
    (err) => {
      assert(err instanceof ApiValidationError);
      assert.equal(err.status, 422);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Token attachment
// ---------------------------------------------------------------------------

test("bearer token is attached to request headers", async () => {
  let capturedHeaders: Headers | undefined;

  global.fetch = (async (url: string, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return {
      ok: true,
      status: 200,
      json: async () => ({ values: {} }),
    };
  }) as unknown as typeof fetch;

  const client = createApiClient({
    baseUrl: "http://localhost:8787",
    getToken: () => "my-secret-token",
  });

  await client.config.get();
  assert.equal(capturedHeaders?.get("authorization"), "Bearer my-secret-token");
});

test("no Authorization header when getToken returns null", async () => {
  let capturedHeaders: Headers | undefined;

  global.fetch = (async (_url: string, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: "t",
        expiresInSeconds: 3600,
        role: "master",
      }),
    };
  }) as unknown as typeof fetch;

  const client = createApiClient({
    baseUrl: "http://localhost:8787",
    getToken: () => null,
  });

  await client.auth.loginMaster({ username: "m", password: "p" });
  assert.equal(capturedHeaders?.has("authorization"), false);
});
