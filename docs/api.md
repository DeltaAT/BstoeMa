# API Guide

The BstöMa API is a Fastify REST service. The **authoritative, always-current reference**
is the Swagger UI served by the running API:

```
http://localhost:8787/documentation        # (or https://<host>:8443/documentation)
```

This page summarizes the auth model, the typical flows, and the full endpoint list with
the role each one requires.

## Authentication

All protected endpoints expect a **Bearer JWT**:

```
Authorization: Bearer <accessToken>
```

Tokens are obtained from the login endpoints below and expire after 1 hour. There are
three roles:

| Role | Login | Token claims | Can do |
|---|---|---|---|
| `master` | `POST /auth/master/login` (`MASTER_USERNAME`/`MASTER_PASSWORD`) | `role` | manage events under `/admin/events/*` |
| `admin` | `POST /auth/admin/login` (event ID + admin credentials) | `role`, `eventId`, `username` | manage the active event it belongs to |
| `waiter` | `POST /auth/login` (username + event passcode) | `role`, `eventId`, `username` | take orders for the active event |

### Login examples

```bash
# Master
curl -X POST http://localhost:8787/auth/master/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"master","password":"<MASTER_PASSWORD>"}'

# Waiter (event must be active; passcode is set by the admin)
curl -X POST http://localhost:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"anna","eventPasscode":"1234"}'

# Authenticated request
curl http://localhost:8787/auth/me -H "Authorization: Bearer $TOKEN"
```

PowerShell variants for the full master → admin → waiter flow are in
[`apps/api/README.md`](../apps/api/README.md).

## Typical flow

1. **Master** creates and activates an event:
   `POST /admin/events` → `POST /admin/events/{id}/activate`.
2. **Admin** logs in and configures the event: create tables (`POST /tables`,
   `POST /tables/bulk`), build the menu (`POST /menu/categories`, `POST /menu/items`),
   register printers (`POST /printers`), set stock (`POST /stock/items`), print table QR
   codes (`GET /tables/qr.pdf`).
3. **Waiters** log in, read the menu and tables, and submit orders
   (`POST /orders`), which can be printed to the assigned kitchen printer
   (`POST /orders/{id}/print`).

## Endpoint reference

Legend — **Role**: who may call it. **Active event**: requires an active event (returns
`409 NO_ACTIVE_EVENT` otherwise).

### Auth

| Method & path | Role | Active event |
|---|---|---|
| `POST /auth/master/login` | public | – |
| `POST /auth/admin/login` | public | – |
| `POST /auth/login` | public | yes |
| `GET /auth/me` | any authenticated | – |

### Events (master lifecycle)

| Method & path | Role | Active event |
|---|---|---|
| `POST /admin/events` | master | – |
| `GET /admin/events` | master | – |
| `GET /admin/events/active` | master, admin | – |
| `POST /admin/events/{eventId}/activate` | master | – |
| `POST /admin/events/{eventId}/deactivate` | master | – |
| `POST /admin/events/{eventId}/close` | master | – |
| `DELETE /admin/events/{eventId}` | master | – |
| `GET /admin/event-passcode` | admin | yes |
| `PUT /admin/event-passcode` | admin | yes |

### Menu

| Method & path | Role | Active event |
|---|---|---|
| `GET /menu/categories` | waiter, admin | yes |
| `GET /menu/items` | waiter, admin | yes |
| `POST /menu/categories` | admin | yes |
| `PATCH /menu/categories/{categoryId}` | admin | yes |
| `DELETE /menu/categories/{categoryId}` | admin | yes |
| `POST /menu/items` | admin | yes |
| `PATCH /menu/items/{menuItemId}` | admin | yes |
| `DELETE /menu/items/{menuItemId}` | admin | yes |

### Tables

| Method & path | Role | Active event |
|---|---|---|
| `GET /tables` | waiter, admin | yes |
| `POST /tables` | admin | yes |
| `POST /tables/bulk` | admin | yes |
| `PATCH /tables/{tableId}` | admin | yes |
| `GET /tables/{tableId}/qr` | admin | yes |
| `GET /tables/{tableId}/qr.pdf` | admin | yes |
| `GET /tables/qr.pdf` | admin | yes |

`GET /tables/qr.pdf` accepts `layout=double` (default, 2 tables/page with a cut line) or
`layout=single` (1 table/page).

### Orders

| Method & path | Role | Active event |
|---|---|---|
| `GET /orders` | admin, waiter | yes |
| `POST /orders` | admin, waiter | yes |
| `GET /orders/{orderId}` | admin, waiter | yes |
| `POST /orders/{orderId}/print` | admin, waiter | yes |

Waiters see/act on their own orders; admins see all. `POST /orders` body:
`{ "tableId": 1, "items": [{ "menuItemId": 1, "quantity": 2, "specialRequests": "..." }] }`.

### Printers

| Method & path | Role | Active event |
|---|---|---|
| `GET /printers` | admin | yes |
| `POST /printers` | admin | yes |
| `GET /printers/{printerId}` | admin | yes |
| `PATCH /printers/{printerId}` | admin | yes |
| `DELETE /printers/{printerId}` | admin | yes |
| `POST /printers/{printerId}/test-print` | admin | yes |

`test-print` returns detailed `409` errors on connection problems
(`PRINTER_CONNECTION_REFUSED`, `PRINTER_CONNECTION_TIMEOUT`, `PRINTER_HOST_UNREACHABLE`,
`PRINTER_CONNECTION_FAILED`), each with `details.target` and a `details.hint`.

### Stock

| Method & path | Role | Active event |
|---|---|---|
| `GET /stock/items` | admin | yes |
| `POST /stock/items` | admin | yes |
| `PATCH /stock/items/{stockItemId}` | admin | yes |
| `GET /menu/items/{menuItemId}/stock-requirements` | admin | yes |
| `PUT /menu/items/{menuItemId}/stock-requirements` | admin | yes |

### Users

| Method & path | Role | Active event |
|---|---|---|
| `GET /users` | admin | yes |
| `POST /users` | admin | yes |
| `GET /users/{userId}` | admin | yes |
| `PATCH /users/{userId}` | admin | yes |
| `DELETE /users/{userId}` | admin | yes |

### Order displays

| Method & path | Role | Active event |
|---|---|---|
| `GET /order-displays` | admin | yes |
| `POST /order-displays` | admin | yes |
| `GET /order-displays/{orderDisplayId}` | admin | yes |
| `PATCH /order-displays/{orderDisplayId}` | admin | yes |
| `DELETE /order-displays/{orderDisplayId}` | admin | yes |

### Config, announcements, logs, ops

| Method & path | Role | Active event |
|---|---|---|
| `GET /config` | admin | yes |
| `PATCH /config` | admin | yes |
| `GET /announcements` | admin, waiter | yes |
| `POST /announcements` | admin | yes |
| `GET /logs` | master, admin | – |
| `GET /host-info` | public | – |

## Error model

Errors use a consistent envelope:

```json
{ "error": { "code": "NO_ACTIVE_EVENT", "message": "…", "details": { } } }
```

Common status codes:

| Status | Meaning |
|---|---|
| `400` | malformed request / bad input |
| `401 UNAUTHORIZED` | missing, malformed, invalid, or expired token |
| `403 FORBIDDEN` | valid token, but wrong role or wrong event binding |
| `404` | resource not found |
| `409 NO_ACTIVE_EVENT` | the operation needs an active event and none exists |
| `409 PRINTER_*` | printer connection problems (with `details.target` + `details.hint`) |
| `409` | other conflicts (e.g. locked resource, duplicate) |
| `422` | validation failed (e.g. `OUT_OF_STOCK` carries `details.insufficient`) |
| `423 USER_LOCKED` | the account is locked |

The typed client in [`packages/api-client`](../packages/api-client) maps these onto an
error class hierarchy (`ApiAuthError`, `ApiForbiddenError`, `ApiNotFoundError`,
`ApiNoActiveEventError`, `ApiPrinterError`, `ApiConflictError`, `ApiValidationError`),
so app code can `catch` specific failures instead of inspecting status codes.
