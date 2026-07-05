# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is BstöMa

A local-first event hospitality platform. An operator laptop runs the API; waiter phones use `waiter-web`; the operator manages events via `admin-desktop`. Everything stays on the local network — no cloud dependency.

## Monorepo layout

pnpm workspaces (`apps/*`, `packages/*`). Package manager: `pnpm@10.33.0`.

| Workspace | Tech | Purpose |
|---|---|---|
| `apps/api` | Fastify 5, TypeScript, better-sqlite3 | REST API, JWT auth, Swagger UI |
| `apps/admin-desktop` | Tauri v2, React 19, Vite | Desktop admin app (scaffold stage) |
| `apps/waiter-web` | React 19, Vite | Waiter PWA (scaffold stage) |
| `packages/shared-types` | Zod 4, TypeScript | Single source of truth for all API contracts |
| `packages/api-client` | TypeScript, `@bstoema/shared-types` | Typed HTTP client (no React); consumed by both apps |
| `packages/auth-context` | React, `@bstoema/shared-types` | `AuthProvider`/`useAuth` hook + lightweight `ApiClient` |

## Common commands

```bash
# Run all apps in parallel (dev mode)
pnpm dev

# Build all
pnpm build

# API only
cd apps/api && pnpm dev          # tsx src/index.ts, port 8787
cd apps/api && pnpm test         # Node built-in test runner, concurrency=1
cd apps/api && pnpm build        # tsc → dist/

# Run a single API test file
cd apps/api && tsx --test src/routes/tables.test.ts

# api-client package
cd packages/api-client && pnpm build
cd packages/api-client && pnpm test

# Waiter web
cd apps/waiter-web && pnpm dev
cd apps/waiter-web && pnpm lint

# Admin desktop (requires Rust toolchain)
cd apps/admin-desktop && pnpm tauri dev
```

The API Swagger UI is available at `http://localhost:8787/documentation` when running.

## API architecture

### Two-database model

`EventStore` maintains a `data/control.db` that tracks all events. Each event gets its own isolated SQLite file at `data/events/event-{id}.db`. All domain stores (menu, tables, users, orders, stock, printers) open a fresh `better-sqlite3` connection to the active event's database on each operation.

### Store pattern

All domain logic lives in `apps/api/src/domain/*-store.ts`. Each store receives `EventStore` in its constructor and calls `eventStore.getActiveEvent()` to get the DB file path. The singletons are wired in `src/domain/state.ts` and imported by routes.

### Route guards via config flags

Routes declare their auth requirements in Fastify's route `config` object rather than inline logic. Three Fastify `preHandler` hooks read these flags:

- `requiresAuth: true` — validates Bearer JWT
- `requiresRole: "master" | "admin" | "waiter"` — exact role match
- `allowedRoles: string[]` — any of the listed roles
- `requiresActiveEvent: true` — rejects with `NO_ACTIVE_EVENT` if no event is active

### Auth roles

| Role | How obtained | Scope |
|---|---|---|
| `master` | `POST /auth/master/login` with `MASTER_USERNAME`/`MASTER_PASSWORD` env vars | Manages events globally |
| `admin` | `POST /auth/admin/login` with event ID + admin credentials | Scoped to one event |
| `waiter` | `POST /auth/login` with username + event passcode | Scoped to one event |

JWT tokens embed `role`, `eventId` (admin/waiter), and `username`. On every authenticated request, `jwt-auth-guard.ts` validates the token and attaches `request.auth`.

### Schema / types contract

`packages/shared-types/src/index.ts` exports every Zod schema and inferred TypeScript type used for API request/response validation. The API uses `fastify-type-provider-zod` so the same schemas drive both runtime validation and OpenAPI spec generation. Both frontend apps import from `@bstoema/shared-types`.

The Prisma schema (`apps/api/prisma/schema.prisma`) defines the event database shape; the corresponding migration SQL in `prisma/migrations/` is the authoritative DDL. The domain stores use raw `better-sqlite3` SQL rather than the Prisma client.

## API environment variables (`apps/api/.env`)

```
DATABASE_URL=file:./dev.db
MASTER_USERNAME=master
MASTER_PASSWORD=<password>
JWT_SECRET=<secret>
```

## `@bstoema/api-client` package

`packages/api-client/src/index.ts` exports `createApiClient({ baseUrl, getToken })` which returns a `BstoemaApiClient` with one typed group per API route group: `auth`, `tables`, `menu`, `orders`, `users`, `printers`, `stock`, `config`, `adminEvents`.

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

Response bodies are validated with the relevant Zod schema from `@bstoema/shared-types`; a mismatch throws `ApiClientError` with code `RESPONSE_PARSE_ERROR`.

## Testing conventions (API)

Tests use Node's built-in `node:test` and `assert/strict`. All test files are co-located with routes as `*.test.ts`.

Every test file calls `setupEventTestUtils(test, eventStore)` from `src/test-utils/event-test-utils.ts` to get:
- `createTestEvent` / `createActiveEventFixture` — creates and registers events for auto-cleanup
- `createAppFixture(buildApp)` — builds a fresh Fastify app registered for auto-close
- `createAuthFixture(app)` — helpers to login as master/admin/waiter via `app.inject()`
- `configureMasterCredentials()` — sets `MASTER_USERNAME`/`MASTER_PASSWORD` env vars for the test

Tests must run with `--test-concurrency=1` because they share a single `EventStore` singleton.