# BstöMa API

## Quick start

```bash
pnpm --filter @bstoema/shared-types build
pnpm --filter api dev
```

Swagger UI: `http://localhost:8787/documentation`

## Tests

```bash
pnpm --filter @bstoema/shared-types build
pnpm --filter api test
```

## Structure

- `src/index.ts` - process entrypoint (listen)
- `src/app.ts` - Fastify app composition
- `src/plugins/*` - cross-cutting hooks (error handling, jwt/auth guards)
- `src/domain/*` - event registry, password hashing, auth services
- `src/routes/*` - route registration by feature

## Active event semantics

- Exactly one event can be active at once.
- Activating an event automatically deactivates a currently active event.
- Endpoints marked with `requiresActiveEvent` return `NO_ACTIVE_EVENT` (`409`) when no event is active.
- Each event gets its own SQLite file under `apps/api/data/events/event-<id>.db`.
- Control metadata (active event, admin credentials, passcode hash) is stored in `apps/api/data/control.db`.
- `POST /admin/events/:eventId/deactivate` is the temporary off switch; it does not set `closedAt`.
- `POST /admin/events/:eventId/close` is terminal; it sets `closedAt`, clears `isActive`, and cannot be repeated.
- `DELETE /admin/events/:eventId` removes the control entry and the event database file.

## Auth model

- `master` can only use the dedicated event lifecycle endpoints under `/admin/events/*`.
- `admin` is event-scoped (`eventId`) and can only use the routes of the currently active event it belongs to.
- `waiter` can only use the waiter routes for the currently active event.
- JWTs carry role-specific claims: `master` -> `role`, `admin` -> `role + eventId + username`, `waiter` -> `role + eventId + username`.

### Error semantics

- `401 UNAUTHORIZED`: missing, malformed, invalid or expired token.
- `403 FORBIDDEN`: correct token format, but wrong role or wrong event binding.
- `409 NO_ACTIVE_EVENT`: the requested operation requires an active event, but none exists.

Configure in `apps/api/.env`:
- `MASTER_USERNAME`
- `MASTER_PASSWORD`
- `JWT_SECRET`

Optional:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `8787`)
- `PRINTER_TEST_PRINT_TIMEOUT_MS` (default `4000`, allowed range `1000..30000`)

## Smoke test

Run the end-to-end backend verification script after starting the API:

```powershell
powershell -File scripts/smoke-test.ps1 -BaseUrl http://localhost:8787
```

The script exercises master login, event lifecycle, waiter/admin guards, CRUD flows, QR/PDF export, and Swagger UI loading.

### Master flow (create event)

PowerShell example:

```powershell
$MASTER_LOGIN = Invoke-RestMethod -Method Post -Uri "http://localhost:8787/auth/master/login" -ContentType "application/json" -Body '{"username":"master","password":"dev-master-password"}'
$MASTER_TOKEN = $MASTER_LOGIN.accessToken
$HEADERS = @{ Authorization = "Bearer $MASTER_TOKEN" }

Invoke-RestMethod -Method Post -Uri "http://localhost:8787/admin/events" -Headers $HEADERS -ContentType "application/json" -Body '{"eventName":"Sommerfest","eventPasscode":"1234","adminUsername":"chef","adminPassword":"secret123"}'
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/admin/events/1/activate" -Headers $HEADERS
Invoke-RestMethod -Method Get -Uri "http://localhost:8787/admin/events/active" -Headers $HEADERS
```

### Event admin flow

```powershell
$EVENT_ADMIN_LOGIN = Invoke-RestMethod -Method Post -Uri "http://localhost:8787/auth/admin/login" -ContentType "application/json" -Body '{"eventId":1,"username":"chef","password":"secret123"}'
$EVENT_ADMIN_TOKEN = $EVENT_ADMIN_LOGIN.accessToken
```

## Waiter auth flow

PowerShell example:

```powershell
$LOGIN = Invoke-RestMethod -Method Post -Uri "http://localhost:8787/auth/login" -ContentType "application/json" -Body '{"username":"anna","eventPasscode":"1234"}'
$ACCESS = $LOGIN.accessToken
$WAITER_HEADERS = @{ Authorization = "Bearer $ACCESS" }

Invoke-RestMethod -Method Get -Uri "http://localhost:8787/auth/me" -Headers $WAITER_HEADERS
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/orders" -Headers $WAITER_HEADERS -ContentType "application/json" -Body '{"tableId":1,"items":[{"menuItemId":1,"quantity":2}]}'
```

## Menu endpoints

- `GET /menu/categories?locked=false&includeRouting=true`
- `GET /menu/items?categoryId=1&sort=weight,name`
- `POST /menu/categories` (`admin`)
- `PATCH /menu/categories/{categoryId}` (`admin`)
- `DELETE /menu/categories/{categoryId}` (`admin`)
- `POST /menu/items` (`admin`)
- `PATCH /menu/items/{menuItemId}` (`admin`)
- `DELETE /menu/items/{menuItemId}` (`admin`)

## Table endpoints

- `GET /tables?locked=false&sort=weight,name` (`waiter/admin`)
- `POST /tables` (`admin`)
- `POST /tables/bulk` (`admin`)
- `PATCH /tables/{tableId}` (`admin`)
- `GET /tables/{tableId}/qr` (`admin`)
- `GET /tables/qr.pdf` (`admin`)

`GET /tables/qr.pdf` supports optional query `layout=double|single`:
- `double` (default): 2 tables per page with cut line
- `single`: 1 table per page

## Printer test-print errors

`POST /printers/{printerId}/test-print` returns detailed `409` API errors for connection problems:
- `PRINTER_CONNECTION_REFUSED`
- `PRINTER_CONNECTION_TIMEOUT`
- `PRINTER_HOST_UNREACHABLE`
- `PRINTER_CONNECTION_FAILED`

Error payload contains `details.target` and a short `details.hint` for troubleshooting.

