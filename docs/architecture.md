# Architecture

Serva is designed around one constraint: **everything runs on the operator's laptop
over a local network, with no cloud.** That shapes the whole system.

## System overview

```
packages/shared-types  ──(Zod schemas + types)───┐
        │                                        │
        ├──> packages/api-client ──> apps that call the API
        ├──> packages/auth-context ──> React apps (auth state)
        └──> apps/api (runtime validation + OpenAPI)
```

- **`apps/api`** is the only component that owns data. It runs on the operator laptop,
  exposes a REST API, validates every request, and serves the waiter PWA at `/waiter/`.
- **`apps/waiter-web`** (phones) and **`apps/admin-desktop`** (operator) are clients.
  They never touch the database directly — they go through the typed `api-client`.
- **`packages/shared-types`** is the contract both sides share, so a change to a request
  or response shape is a compile error on whichever side falls out of sync.

## The shared-types contract

`packages/shared-types/src/index.ts` exports every Zod schema and its inferred
TypeScript type used for API requests and responses. The API uses
`fastify-type-provider-zod`, so **the same schemas drive both runtime validation and the
generated OpenAPI/Swagger spec**. Both frontends import these types via `api-client`.

The Prisma schema (`apps/api/prisma/schema.prisma`) and its migration SQL describe the
event-database shape. Prisma is used for migrations/DDL; at runtime the domain stores use
raw `better-sqlite3` SQL rather than the Prisma client.

## Two-database model

Serva isolates each event in its own SQLite file:

- **`apps/api/data/control.db`** — the registry. Tracks every event plus its control
  metadata: which event is active, admin credentials, the hashed waiter passcode,
  `closedAt`, etc. Managed by `EventStore`.
- **`apps/api/data/events/event-<id>.db`** — one file per event. Holds that event's
  menu, tables, users, orders, stock, printers, and order displays.

Why per-event files: an event is a self-contained unit. Isolating it keeps data clean,
makes "close" and "delete" trivial (deactivate clears the active flag; delete removes the
file), and avoids cross-event leakage.

### Active-event semantics

- Exactly **one** event is active at a time. Activating one deactivates any other.
- Endpoints that need event data declare `requiresActiveEvent` and return
  `409 NO_ACTIVE_EVENT` when none is active.
- **Deactivate** (`POST /admin/events/:id/deactivate`) is a temporary off switch.
- **Close** (`POST /admin/events/:id/close`) is terminal — sets `closedAt`, clears the
  active flag, and can't be repeated.
- **Delete** (`DELETE /admin/events/:id`) removes the control entry and the event's
  database file.

## Store pattern

All domain logic lives in `apps/api/src/domain/*-store.ts` (menu, tables, users, orders,
stock, printers, order-displays, announcements, config, auth). Each store:

1. Receives `EventStore` in its constructor.
2. Calls `eventStore.getActiveEvent()` to resolve the active event's DB file path.
3. Opens a fresh `better-sqlite3` connection to that file per operation and ensures its
   schema exists.

The singletons are wired together in `apps/api/src/domain/state.ts` and imported by the
route modules in `apps/api/src/routes/*`.

## Request lifecycle & route guards

The Fastify app is composed in `apps/api/src/app.ts`. Routes declare their auth
requirements **declaratively** in Fastify's route `config` object instead of writing
inline checks; `preHandler` hooks (in `apps/api/src/plugins/*`) read those flags:

| Config flag | Effect |
|---|---|
| `requiresAuth: true` | validates the Bearer JWT and attaches `request.auth` |
| `requiresRole: "master" \| "admin" \| "waiter"` | requires that exact role |
| `allowedRoles: string[]` | requires any of the listed roles |
| `requiresActiveEvent: true` | rejects with `NO_ACTIVE_EVENT` if no event is active |

The plugins involved: `jwt-auth-guard` (token validation), `admin-auth-guard`,
`active-event-guard`, `error-handler` (uniform error envelopes), and `log-buffer` (an
in-memory log ring exposed via the logs route).

The app also serves the built waiter PWA statically at `/waiter/` and falls back to
`index.html` for client-side deep links under that prefix (so a phone can reload any
waiter route).

## Auth roles

| Role | How obtained | Scope |
|---|---|---|
| `master` | `POST /auth/master/login` with `MASTER_USERNAME`/`MASTER_PASSWORD` | global; only the event-lifecycle endpoints under `/admin/events/*` |
| `admin` | `POST /auth/admin/login` with event ID + admin credentials | one event; manages that event's menu/tables/users/etc. |
| `waiter` | `POST /auth/login` with username + event passcode | one event; the waiter ordering routes |

JWTs carry role-specific claims — `master` → `role`; `admin`/`waiter` → `role + eventId +
username`. On every authenticated request, `jwt-auth-guard` validates the token and
attaches `request.auth`.

See the [API Guide](api.md) for concrete request/response examples and the error model.

## Networking & transport

- The API binds `HOST` (default `0.0.0.0`) so phones on the LAN can reach it.
- If a TLS cert exists at `apps/api/tls/` (created by `pnpm --filter api gen-cert`), the
  API serves **HTTPS** on `HTTPS_PORT` (8443) *and* plain HTTP on `PORT` (8787) for
  backwards compatibility. Without a cert, it serves HTTP only. HTTPS matters because the
  waiter PWA's camera-based QR scanner requires a secure context on phones.
