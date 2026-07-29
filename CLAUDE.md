# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is BstöMa

A local-first event hospitality platform. An operator laptop runs the API; waiter phones use `waiter-web` (served by the API at `/waiter/`); the operator manages events via `admin-desktop`. Everything stays on the local network — no cloud dependency.

## Answering questions about this codebase

For questions about architecture, file relationships, or how a feature flows across
workspaces, query the knowledge graph in `graphify-out/` first — invoke the `graphify`
skill with the question rather than starting from a blind file search. Fall back to
reading files directly when the graph doesn't cover it.

The graph is a snapshot, not live. Before trusting it for anything you're about to
change, check `graphify-out/manifest.json` against the working tree, and refresh with
`/graphify . --update` (incremental — only re-extracts changed files) if it has drifted.
Verify any specific file path, symbol, or flag the graph reports still exists before
acting on it.

## Monorepo layout

pnpm workspaces (`apps/*`, `packages/*`). Package manager: `pnpm@10.33.0`.

| Workspace | pnpm filter name | Tech | Purpose |
|---|---|---|---|
| `apps/api` | `api` | Fastify 5, TypeScript, better-sqlite3 | REST API, JWT auth, Swagger UI; also serves the waiter PWA |
| `apps/admin-desktop` | `appsadmin-desktop` | Tauri v2, React 19, Vite | Desktop admin app (bundles and spawns the API) |
| `apps/waiter-web` | `waiter-web` | React 19, Vite (PWA) | Waiter ordering app for phones |
| `packages/shared-types` | `@bstoema/shared-types` | Zod 4, TypeScript | Single source of truth for all API contracts |
| `packages/api-client` | `@bstoema/api-client` | TypeScript | Typed HTTP client (no React); consumed by both apps |
| `packages/auth-context` | `@bstoema/auth-context` | React | `AuthProvider`/`useAuth` hook + token storage |

Note the admin-desktop package name is literally `appsadmin-desktop` — `pnpm --filter admin-desktop` will not match it.

## Common commands

```bash
pnpm dev                          # all workspaces in parallel (API + both Vite servers)
pnpm build                        # version:sync, then build every workspace
pnpm build:server                 # shared packages + waiter-web only (no Tauri)
pnpm tauri:build                  # full desktop installer (needs Rust)
pnpm version:sync                 # propagate root version to all manifests

# API
pnpm --filter api dev             # tsx src/index.ts — HTTP :8787 + HTTPS :8443
pnpm --filter api test            # node:test via tsx, --test-concurrency=1
pnpm --filter api build           # tsc → dist/
pnpm --filter api gen-cert        # write a self-signed cert into apps/api/tls/
pnpm --filter api build:runtime   # bundle API + waiter into src-tauri/resources/

# Frontends
pnpm --filter waiter-web dev      # Vite :5173, app lives under /waiter/
pnpm --filter waiter-web lint     # eslint (waiter-web is the only linted app)
pnpm --filter waiter-web test:e2e # Playwright; boots API + Vite itself
pnpm --filter appsadmin-desktop tauri dev   # Tauri window (Vite :1420)
pnpm --filter appsadmin-desktop test:e2e    # Playwright against the Vite build
```

Run a single API test file:

```bash
cd apps/api && tsx --test src/routes/tables.test.ts
```

`@bstoema/shared-types` must be built before API or api-client tests — the apps import its compiled output, not its source. After changing a contract there, rebuild it (`pnpm --filter @bstoema/shared-types build`).

Swagger UI: `http://localhost:8787/documentation` while the API runs.

## Versioning

The root `package.json` `version` is the single source of truth. `scripts/sync-versions.mjs` (`pnpm version:sync`, auto-run before `pnpm build` and `pnpm tauri:build`) copies it into every workspace manifest and into `src-tauri/Cargo.toml`. To cut a release, bump the root version only.

## API architecture

### Two-database model

`EventStore` maintains `data/control.db` listing all events; each event gets its own SQLite file at `data/events/event-{id}.db`. Only one event can be active at a time (enforced by a partial unique index on `isActive`). All domain stores open a fresh `better-sqlite3` connection to the active event's database on each operation.

### Store pattern

Domain logic lives in `apps/api/src/domain/*-store.ts`. Each store takes `EventStore` in its constructor and calls `eventStore.getActiveEvent()` for the DB path. Singletons are wired in `src/domain/state.ts` and imported by routes.

`MasterCredentialsStore` is the exception: it is file-backed (`data/master-credentials.json`, scrypt-hashed) and exists for the bundled desktop app, which ships without `MASTER_*` env vars — the operator sets them via `POST /auth/master/setup` on first run. When `MASTER_USERNAME`/`MASTER_PASSWORD` are set (dev and tests), they take precedence and this store is never touched.

`startPrintQueueWorker` (`domain/print-queue-worker.ts`) runs from `src/index.ts` and retries bons that were queued while a printer was offline. It must be started **before** `app.listen()` — Fastify throws `FST_ERR_INSTANCE_ALREADY_LISTENING` when adding its `onClose` hook to a started instance.

### Route guards via config flags

Routes declare auth requirements in Fastify's route `config` object (typed in `src/types/fastify.d.ts`); `preHandler` hooks in `src/plugins/` read them:

- `requiresAuth: true` — validates Bearer JWT
- `requiresRole: "master" | "admin" | "waiter"` — exact role match
- `allowedRoles: string[]` — any of the listed roles
- `requiresActiveEvent: true` — rejects with `NO_ACTIVE_EVENT` if no event is active

### Auth roles

| Role | How obtained | Scope |
|---|---|---|
| `master` | `POST /auth/master/login` (env vars, or credentials set via `/auth/master/setup`) | Manages events globally |
| `admin` | `POST /auth/admin/login` with event ID + admin credentials | Scoped to one event |
| `waiter` | `POST /auth/login` with username + event passcode | Scoped to one event |

`jwt-auth-guard.ts` validates the token on every authenticated request and attaches `request.auth` (`role`, `eventId`, `username`).

### HTTP + HTTPS dual listener

`src/index.ts` generates/refreshes a self-signed cert on boot (`tls/ensure-cert.ts`) and uses a Fastify `serverFactory` so the **same handler** serves HTTPS on `:8443` (the "main" listener) and plain HTTP on `:8787`. Phones need the secure context for live camera/QR scanning. `BSTOEMA_DISABLE_HTTPS=1` falls back to HTTP only.

### Serving the waiter PWA

`app.ts` resolves the waiter-web `dist/` via `WAITER_DIST_PATH` or a relative monorepo lookup and mounts it at `/waiter/` with `@fastify/static`. The PWA uses `base: '/waiter/'` in both dev and prod so its client routes never collide with API paths (`/orders` the API vs `/waiter/orders` the GUI). SPA deep-link reloads are handled in `setNotFoundHandler`, which matches on the pathname only so `/waiter?passcode=…` (the QR login link) still resolves.

### CORS

CORS headers are injected in a global `onSend` hook plus the not-found handler (which also answers `OPTIONS` preflights with 204). Any response path that bypasses `onSend` — hijacked replies, raw `res.end()` — loses its CORS headers and surfaces in the browser as "Failed to fetch".

### Schema / types contract

`packages/shared-types/src/index.ts` exports every Zod schema and inferred type used for request/response validation. The API uses `fastify-type-provider-zod`, so the same schemas drive runtime validation and OpenAPI generation. Both frontends import from `@bstoema/shared-types`.

`apps/api/prisma/schema.prisma` defines the event database shape and the migration SQL in `prisma/migrations/` is the authoritative DDL, but the domain stores use raw `better-sqlite3` SQL rather than the Prisma client. Small additive changes are sometimes applied as guarded `ALTER TABLE` calls in the store's schema init (see `EventStore.initializeControlSchema`).

## Desktop app bundling

`apps/api/scripts/build-runtime.mjs` assembles a self-contained runtime into `apps/admin-desktop/src-tauri/resources/`:

- `api/node.exe` — private Node runtime copied from the build machine
- `api/server.mjs` — esbuild bundle of the whole API (gitignored)
- `api/node_modules/` — the non-bundlable externals (better-sqlite3 native addon, swagger-ui assets)
- `waiter/` — the waiter-web production build

`tauri.conf.json` copies both folders into the app resource dir and `src-tauri/src/lib.rs` spawns `api/node.exe api/server.mjs` with `WAITER_DIST_PATH` pointing at `waiter/`. **The desktop app runs the bundle, not the source tree** — after changing API source you must re-run `pnpm --filter api build:runtime` (or `pnpm tauri:build`) or the desktop app keeps running the stale server.

## API environment variables (`apps/api/.env`)

See `apps/api/.env.example`. Required: `DATABASE_URL` (Prisma CLI only), `MASTER_USERNAME`, `MASTER_PASSWORD`, `JWT_SECRET`. Optional: `HOST`, `PORT` (8787), `HTTPS_PORT` (8443), `BSTOEMA_DISABLE_HTTPS`, `WAITER_DIST_PATH`, `LOG_LEVEL`, `PRINTER_TEST_PRINT_TIMEOUT_MS`.

## `@bstoema/api-client`

`createApiClient({ baseUrl, getToken })` returns a `BstoemaApiClient` with one typed group per route group: `auth`, `adminEvents`, `announcements`, `config`, `logs`, `menu`, `orders`, `orderDisplays`, `ops`, `printers`, `stock`, `tables`, `users`.

**Error hierarchy** — thrown instead of returning error shapes:

| Class | Status | Codes |
|---|---|---|
| `ApiAuthError` | 401 | `UNAUTHORIZED` |
| `ApiForbiddenError` | 403 | any |
| `ApiNotFoundError` | 404 | any |
| `ApiNoActiveEventError` | 409 | `NO_ACTIVE_EVENT` |
| `ApiPrinterError` | 409 | `PRINTER_*` — has `.target` and `.hint` |
| `ApiConflictError` | 409 | everything else |
| `ApiValidationError` | 422 | any |
| `ApiClientError` | other | base class for all of the above |

Response bodies are validated with the relevant Zod schema; a mismatch throws `ApiClientError` with code `RESPONSE_PARSE_ERROR`.

Both frontends wrap this in an `ApiClientContext` (`src/contexts/ApiClientContext.tsx`) that must be rendered inside `<AuthProvider>`; components call `useApiClient()` rather than constructing a client.

## Testing conventions

### API (`node:test`)

Tests use Node's built-in `node:test` and `assert/strict`, co-located with routes as `*.test.ts`. Every test file calls `setupEventTestUtils(test, eventStore)` from `src/test-utils/event-test-utils.ts` for:

- `createTestEvent` / `createActiveEventFixture` — create and register events for auto-cleanup
- `createAppFixture(buildApp)` — a fresh Fastify app registered for auto-close
- `createAuthFixture(app)` — login as master/admin/waiter via `app.inject()`
- `configureMasterCredentials()` — sets the `MASTER_*` env vars for the test

Tests must run with `--test-concurrency=1` because they share the single `EventStore` singleton.

### E2E (Playwright)

`apps/waiter-web/e2e/` and `apps/admin-desktop/e2e/` each have a `playwright.config.ts` whose `webServer` boots `pnpm --filter api dev` plus the app's own Vite server (`:5173` / `:1420`), single worker, `reuseExistingServer` outside CI. These hit a real API against real `data/` files.

## Documentation

`docs/` holds the long-form docs: `getting-started.md` (install, phones/HTTPS, troubleshooting), `architecture.md`, `api.md`, and `docs/Planning/` for design notes. Each workspace also has its own README.
