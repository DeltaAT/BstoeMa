# Serva

**A local-first event hospitality platform.** Run it from a single laptop at your
event — no cloud, no internet dependency, no monthly fees. The operator's laptop
hosts the API and the apps; waiters take orders from their phones; the operator
manages everything from a desktop admin app. All of it talks over your own local
network.

> Manage events, serve customers — everything local, with your laptop and your phones.

---

## How it works

```
                  Local Wi-Fi / LAN
                          │
   ┌──────────────────────┼────────────────────────┐
   │                      │                        │
┌──┴─────────────┐   ┌────┴────────┐       ┌───────┴────────┐
│ Operator       │   │ Waiter      │       │ Waiter         │
│ laptop         │   │ phone       │  ...  │ phone          │
│                │   │ (browser)   │       │ (browser)      │
│ • API (Fastify)│   │ waiter-web  │       │ waiter-web     │
│ • admin-desktop│   │ PWA         │       │ PWA            │
│ • waiter-web   │   └─────────────┘       └────────────────┘
│   (served at   │
│    /waiter/)   │
└────────────────┘
```

- The **API** runs on the operator's laptop and owns all data (SQLite files on disk).
- **waiter-web** is a phone PWA the API serves at `/waiter/`; waiters scan a table
  QR code, browse the menu, and send orders straight to the kitchen printer.
- **admin-desktop** is a Tauri desktop app the operator uses to create events,
  manage the menu/tables/users, and watch incoming orders.

Because everything is local, the venue keeps working even when the internet doesn't.

---

## Monorepo layout

pnpm workspaces (`apps/*`, `packages/*`).

| Workspace | Tech | Purpose |
|---|---|---|
| [`apps/api`](apps/api) | Fastify 5, TypeScript, better-sqlite3 | REST API, JWT auth, Swagger UI; serves the waiter PWA |
| [`apps/admin-desktop`](apps/admin-desktop) | Tauri v2, React 19, Vite | Desktop admin app for the operator |
| [`apps/waiter-web`](apps/waiter-web) | React 19, Vite (PWA) | Waiter ordering app for phones |
| [`packages/shared-types`](packages/shared-types) | Zod 4, TypeScript | Single source of truth for all API contracts |
| [`packages/api-client`](packages/api-client) | TypeScript | Typed HTTP client (framework-agnostic) |
| [`packages/auth-context`](packages/auth-context) | React | `AuthProvider` / `useAuth` hook for the apps |

---

## Prerequisites

- **Node.js 20.19+** (22 LTS recommended).
- **pnpm 10** — the repo pins `pnpm@10.33.0`. The easiest way to get the right
  version is Corepack: `corepack enable && corepack prepare pnpm@10.33.0 --activate`.
- **Rust toolchain** — only needed to build/run `admin-desktop` (Tauri v2). See the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
  (on Windows you also need the WebView2 runtime and MSVC build tools). You do **not**
  need Rust to run the API or the waiter PWA.

---

## Quick start

```bash
# 1. Install dependencies for every workspace
pnpm install

# 2. Build the shared packages (the apps import their compiled output)
pnpm build

# 3. Configure the API (see apps/api/.env.example)
cp apps/api/.env.example apps/api/.env
#   then edit apps/api/.env and set MASTER_PASSWORD and JWT_SECRET

# 4. Run everything in dev mode (API + both frontends, in parallel)
pnpm dev
```

What's now running:

| Service | URL |
|---|---|
| API (HTTP) | http://localhost:8787 |
| API Swagger UI | http://localhost:8787/documentation |
| Waiter PWA (Vite dev) | http://localhost:5173/waiter/ |
| Admin desktop | launches as a Tauri window (needs Rust) |

> The shared packages (`shared-types`, `api-client`, `auth-context`) have no dev
> server — they are compiled once by `pnpm build`. Re-run `pnpm build` (or build the
> specific package) after changing a contract in `shared-types`.

Want just the backend? `pnpm --filter @serva/shared-types build && pnpm --filter api dev`.

New here? Read the **[Getting Started guide](docs/getting-started.md)** for a
step-by-step walkthrough, including how to reach the apps from real phones.

---

## Using Serva (the happy path)

Serva has three roles. A typical event runs like this:

1. **Master** logs in (`MASTER_USERNAME` / `MASTER_PASSWORD` from `.env`) and creates
   an event with an admin account and a waiter passcode, then **activates** it. Only
   one event is active at a time.
2. **Admin** logs in with the event's admin credentials and sets up the menu, tables
   (printing QR codes), printers, and stock.
3. **Waiters** open the waiter PWA on their phones, log in with their name + the event
   passcode, scan a table's QR code, and send orders — which print on the assigned
   kitchen printer.

Full role/permission details and request examples are in the
[API guide](docs/api.md) and [`apps/api/README.md`](apps/api/README.md).

---

## Accessing the apps from phones

Phones connect to the operator laptop over the local network using the laptop's LAN
IP (the API listens on `0.0.0.0`). The QR scanner needs a **secure context**, so for
real phone use you should enable HTTPS:

```bash
pnpm --filter api gen-cert      # writes a self-signed cert to apps/api/tls/
pnpm --filter waiter-web build  # build the PWA so the API can serve it
pnpm --filter api dev           # now serving https://<laptop-ip>:8443/waiter/
```

Then point a phone browser at `https://<laptop-ip>:8443/waiter/` (accept the
self-signed certificate warning once). See
[Getting Started → phones & HTTPS](docs/getting-started.md#running-on-phones-https)
for the details.

---

## Testing

```bash
pnpm --filter @serva/shared-types build   # required before API/client tests
pnpm --filter api test                    # API: node:test, run serially
pnpm --filter @serva/api-client test      # typed client tests
pnpm --filter waiter-web test:e2e         # Playwright (boots API + Vite)
```

---

## Documentation

- [Getting Started](docs/getting-started.md) — install, run, run on phones, troubleshoot
- [Architecture](docs/architecture.md) — system design, two-database model, auth roles
- [API Guide](docs/api.md) — auth flows, endpoint reference, error model
- [`docs/Planning`](docs/Planning) — design notes, diagrams, and milestone planning

Each workspace also has its own README with details specific to that package.

---

## License

[MIT](LICENSE) © 2026 Elias Pöschl
