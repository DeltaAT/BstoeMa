# Getting Started

This guide takes you from a fresh clone to a running Serva stack, including reaching
the waiter app from real phones.

## 1. Prerequisites

- **Node.js 20.19+** (22 LTS recommended).
- **pnpm 10** (`pnpm@10.33.0` is pinned by the repo). Recommended install via Corepack:
  ```bash
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
  ```
- **Rust toolchain** — only for `admin-desktop` (Tauri v2). Follow the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows you also
  need the WebView2 runtime and the MSVC C++ build tools. Skip this if you only need the
  API and waiter PWA.

## 2. Install

```bash
git clone https://github.com/DeltaAT/Serva.git
cd Serva
pnpm install
```

## 3. Build the shared packages

The apps import the **compiled** output of the workspace packages, so build them once:

```bash
pnpm build
```

Re-run this (or `pnpm --filter @serva/shared-types build`) whenever you change an API
contract in `packages/shared-types`.

## 4. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set at least:

| Variable | Purpose |
|---|---|
| `MASTER_USERNAME` / `MASTER_PASSWORD` | the global operator login |
| `JWT_SECRET` | long random string used to sign tokens |
| `DATABASE_URL` | Prisma connection string (default `file:./dev.db` is fine) |

Optional: `HOST`, `PORT` (default `8787`), `HTTPS_PORT` (default `8443`),
`PRINTER_TEST_PRINT_TIMEOUT_MS`.

If you'll run the desktop app too: `cp apps/admin-desktop/.env.example apps/admin-desktop/.env`.

## 5. Run

```bash
pnpm dev
```

This runs every workspace that has a `dev` script in parallel:

| Service | URL |
|---|---|
| API (HTTP) | http://localhost:8787 |
| Swagger UI | http://localhost:8787/documentation |
| Waiter PWA (Vite dev) | http://localhost:5173/waiter/ |
| Admin desktop | a Tauri window (needs Rust) |

Run pieces individually if you prefer:

```bash
pnpm --filter api dev               # backend only (port 8787)
pnpm --filter waiter-web dev        # waiter PWA only (Vite, port 5173)
pnpm --filter appsadmin-desktop tauri dev   # desktop app only
```

## 6. First run — create an event

The database starts empty. Use the **master** account to create and activate an event
before anything else works. The quickest way is the Swagger UI
(`/documentation`) or the PowerShell snippets in
[`apps/api/README.md`](../apps/api/README.md#master-flow-create-event). In short:

1. `POST /auth/master/login` with your master credentials → copy the `accessToken`.
2. `POST /admin/events` with an `eventName`, `eventPasscode`, `adminUsername`,
   `adminPassword`.
3. `POST /admin/events/{id}/activate`.

Now an admin can log in (`POST /auth/admin/login`) to build the menu/tables, and
waiters can log in (`POST /auth/login`) with their name + the event passcode. See the
[API Guide](api.md) for the full flow.

## Running on phones (HTTPS)

Phones reach the operator laptop over the local network. Two things matter:

1. **Use the laptop's LAN IP**, not `localhost`. The API binds `0.0.0.0`, so phones can
   reach it at `http(s)://<laptop-ip>:<port>`. Find the IP with `ipconfig` (Windows) or
   `ip addr` / `ifconfig` (macOS/Linux). Make sure the laptop firewall allows inbound
   connections on the API port.
2. **Enable HTTPS** — the QR scanner uses the camera, which browsers only allow in a
   secure context. Generate a self-signed certificate:
   ```bash
   pnpm --filter api gen-cert      # writes apps/api/tls/cert.pem + key.pem
   pnpm --filter waiter-web build  # build the PWA so the API serves it at /waiter/
   pnpm --filter api dev
   ```
   The API now also listens on `https://<laptop-ip>:8443`. Open
   `https://<laptop-ip>:8443/waiter/` on the phone and accept the certificate warning
   once.

> In dev (`pnpm dev`), the waiter PWA is served by Vite on port `5173` at `/waiter/`.
> For phone/QR use, build the PWA and let the API serve it over HTTPS as above.

## Troubleshooting

- **`Cannot find module '@serva/shared-types'` (or `api-client`/`auth-context`)** — you
  skipped step 3. Run `pnpm build`.
- **API responds `409 NO_ACTIVE_EVENT`** — no event is active. Create and activate one
  (step 6).
- **Phone can't load the app** — you used `localhost` instead of the laptop IP, the
  firewall is blocking the port, or the phone is on a different network/VLAN.
- **Camera/QR scanner won't start on the phone** — you're on `http://`. Use the HTTPS
  setup above (camera needs a secure context).
- **`HTTPS disabled` log line** — no cert found; run `pnpm --filter api gen-cert`.
- **Changed a schema in `shared-types` but apps don't see it** — rebuild it
  (`pnpm --filter @serva/shared-types build`).

## Verifying the backend (smoke test)

With the API running:

```powershell
powershell -File apps/api/scripts/smoke-test.ps1 -BaseUrl http://localhost:8787
```

It exercises master login, the event lifecycle, waiter/admin guards, CRUD flows,
QR/PDF export, and Swagger UI loading.
