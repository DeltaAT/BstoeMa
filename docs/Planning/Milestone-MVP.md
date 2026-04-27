# Milestone: MVP — Frontends on top of the existing API

> Paste-ready GitHub milestone description and issues. Created 2026-04-26 as a follow-up to the project scan.
> The backend (`apps/api`) is essentially feature-complete for the MVP scope. This milestone covers the two frontends (`apps/waiter-web` and `apps/admin-desktop`), plus the small amount of shared infrastructure they both need.

---

## Milestone description (paste this into the GitHub milestone "Description" field)

**Title:** `MVP — Waiter Web & Admin Desktop`

**Due date suggestion:** ~6 weeks from kick-off (adjust based on capacity).

**Goal**
Ship the smallest end-to-end product that lets a real event run on Serva: an admin sets up the event on the desktop app, waiters log in from their phones, browse the menu, place orders, and the kitchen receives prints. No checkout/receipt in this milestone (explicitly deferred — see `docs/Planning/Checkout-Receipt-Followup.md`).

**Definition of done**
- A waiter can log in on a phone with `username + eventPasscode`, pick a table, browse categories/items, place an order, and see the four documented edge-cases handled (locked entity → `409`, out-of-stock → `422`, validation → `400`, auth → `401/403`).
- An admin can, from the desktop app: log in as `master`, create + activate an event, log in as event `admin`, manage menu/tables/printers/users/stock/config, export table QR PDFs, and watch the order history.
- Both apps share a single typed API client and auth context, generated against `@serva/shared-types`.
- All issues in this milestone are closed and the existing API smoke test still passes.

**Out of scope (deferred to backlog)**
Checkout + receipt (JSON and PDF), `priceSnapshot` migration, push notifications, cross-event analytics, multi-language UI (German strings can come in a polish milestone).

---

## Suggested labels (create these once if they don't exist)

- `area:waiter-web`
- `area:admin-desktop`
- `area:shared`
- `type:feature`
- `type:chore`
- `priority:p0` (blocking the MVP)
- `priority:p1` (needed but not blocking)
- `good-first-issue`

---

# Issues

> Each issue below is structured as: **Title** → labels → body. Copy the title into the issue title, paste the body into the body, apply the labels.

---

## Phase 0 — Shared infrastructure

These come first because both frontends consume them.

### Issue 1 — Add shared API client package

**Title:** `chore(shared): add @serva/api-client package with typed fetch wrapper`

**Labels:** `area:shared`, `type:chore`, `priority:p0`

**Body:**

Create a new workspace package `packages/api-client` that both `apps/waiter-web` and `apps/admin-desktop` consume. Goal: have one place where the HTTP layer lives, parameterised on base URL and token provider.

Scope
- New package `@serva/api-client` with its own `package.json`, `tsconfig.json`, `src/index.ts`.
- Depends on `@serva/shared-types` and `zod`.
- Exposes a `createApiClient({ baseUrl, getToken })` factory returning a typed object: one method per API route group (`auth`, `tables`, `menu`, `orders`, `users`, `printers`, `orderDisplays`, `stock`, `config`, `adminEvents`).
- Each method validates the response with the relevant Zod schema from `@serva/shared-types` and throws a typed `ApiError` carrying `status`, `code`, and `details`.
- Maps the documented error semantics from `apps/api/README.md`:
  - `401 UNAUTHORIZED` → `ApiAuthError`
  - `403 FORBIDDEN` → `ApiForbiddenError`
  - `409 NO_ACTIVE_EVENT` → `ApiNoActiveEventError`
  - `409 PRINTER_*` → `ApiPrinterError` with `target` and `hint`
  - `409 ALREADY_LOCKED` / similar → generic `ApiConflictError`
  - `422` → `ApiValidationError`
- No React dependency in this package.

Acceptance criteria
- `pnpm --filter @serva/api-client build` succeeds.
- A throwaway smoke test (or vitest) confirms a typed call against a mocked `fetch` returns parsed shapes.
- `apps/waiter-web` and `apps/admin-desktop` can both import it.

---

### Issue 2 — Add shared React auth context + token storage

**Title:** `feat(shared): add @serva/auth-context for React (token store + provider)`

**Labels:** `area:shared`, `type:feature`, `priority:p0`

**Body:**

Both frontends need the same auth bookkeeping: persist the access token, expose it to the API client, react to 401s. Build it once.

Scope
- New package `packages/auth-context` (or a `packages/ui-shared` folder if we expect more shared React pieces).
- `AuthProvider` React component with `useAuth()` hook returning `{ user, login, logout, token, role }`.
- Token persisted in `localStorage` (waiter-web) / Tauri secure store (admin-desktop) — abstract behind a `TokenStorage` interface so each app injects its own.
- Auto-logout on `401` from any API call (the API client emits an event the auth context listens to).
- Role-aware: distinguishes `master`, `admin`, `waiter` per the API auth model.

Acceptance criteria
- `useAuth()` works in both apps.
- Refreshing the page keeps the user logged in until the JWT expires.
- A `401` from any endpoint clears the token and routes to `/login`.

---

## Phase 1 — Waiter Web (`apps/waiter-web`)

### Issue 3 — Replace Vite starter shell with real app shell

**Title:** `chore(waiter-web): replace Vite starter with router + layout shell`

**Labels:** `area:waiter-web`, `type:chore`, `priority:p0`

**Body:**

`apps/waiter-web/src/App.tsx` is still the Vite counter demo. Replace it with the real shell.

Scope
- Add `react-router-dom`.
- Routes: `/login`, `/tables`, `/tables/:tableId/menu`, `/tables/:tableId/order`, `/orders`.
- Mobile-first layout: header (event name + logout), main view, bottom nav for `Tables`, `My Orders`.
- Global error boundary that renders a friendly fallback for any thrown `ApiError`.
- Wrap the tree in `AuthProvider` from Issue 2 and an `ApiClientProvider` from Issue 1.
- Strip the `assets/`, `App.css`, `index.css` Vite demo styles; replace with a minimal stylesheet.

Acceptance criteria
- `pnpm --filter waiter-web dev` shows the new shell.
- Unauthenticated routes redirect to `/login`; authenticated routes redirect away from `/login`.
- The existing `contractSmokeTests` block in `App.tsx` is removed (the type checks happen via the shared API client now).

---

### Issue 4 — Login screen

**Title:** `feat(waiter-web): waiter login (username + event passcode)`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p0`

**Body:**

Implement the waiter login flow against `POST /auth/login`.

Scope
- Form with two fields: `username`, `eventPasscode`.
- On submit: call `apiClient.auth.login()`, store token via `useAuth().login(...)`, redirect to `/tables`.
- Show inline errors:
  - `400` — "Username or passcode is invalid" (validation)
  - `401` — "Username or passcode is incorrect"
  - `423` — "This waiter account is locked. Please contact an admin."
  - Generic network error — friendly retry prompt
- Disable submit while in flight, prevent double-submit.
- Auto-create-on-first-login behaviour is server-side (per `docs/Planning/API-Endpoints.md`) — the client doesn't need to handle it specially.

Acceptance criteria
- Successful login lands on `/tables`.
- Wrong passcode shows an error inline, doesn't navigate.
- Reloading the page after login keeps the user signed in.

---

### Issue 5 — Table picker

**Title:** `feat(waiter-web): table picker screen`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p0`

**Body:**

After login, show the list of tables the waiter can use.

Scope
- Calls `GET /tables?locked=false&sort=weight,name`.
- Renders a grid/list of tables with their `name` (e.g. `A1`, `B3`).
- Tapping a table navigates to `/tables/:tableId/menu`.
- Empty state when no tables exist ("Ask an admin to create tables").
- Loading skeleton, error retry button.

Acceptance criteria
- A waiter sees only unlocked tables, sorted by weight then name.
- Tapping a table opens the menu screen for that table.

---

### Issue 6 — Optional: QR scan flow to resolve table

**Title:** `feat(waiter-web): scan a table QR to jump straight into the menu`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p1`

**Body:**

Each table has a printed QR code (admins generate them via `GET /tables/qr.pdf`). Scanning it should drop the waiter straight onto that table's menu.

Scope
- Add a "Scan QR" action on `/tables`.
- Use the device camera (e.g. via `@zxing/browser` or `qr-scanner`) to read the QR value.
- Validate the value with `TableQrResolveRequestSchema` from `@serva/shared-types` (already exists — there is a smoke test in `App.tsx` referencing it).
- Resolve to a `tableId` and navigate to `/tables/:tableId/menu`.
- Fallback: if camera permission denied, fall through to the manual table list.

Acceptance criteria
- Scanning a real printed QR opens the right table's menu screen.
- Permission denial is handled gracefully.

---

### Issue 7 — Menu browse (categories + items)

**Title:** `feat(waiter-web): menu browse (categories + items)`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p0`

**Body:**

Implement the menu screen at `/tables/:tableId/menu`.

Scope
- Top: horizontal scroller / tab strip of categories from `GET /menu/categories?locked=false`.
- Body: grid of items from `GET /menu/items?categoryId=…&locked=false&sort=weight,name`.
- Each item card shows name, description, price.
- Tapping an item adds 1 to the cart (state local to the screen for now; lifted in Issue 8).
- Show a small floating cart button with current item count + total when cart is non-empty.

Acceptance criteria
- Switching categories re-fetches items.
- Locked items/categories are not shown.
- The floating cart button appears as soon as a first item is added.

---

### Issue 8 — Cart + place order

**Title:** `feat(waiter-web): cart screen and POST /orders`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p0`

**Body:**

Implement the cart view at `/tables/:tableId/order` and submit the order.

Scope
- Cart UI: list of items with quantity steppers, remove button, optional `specialRequests` text per line.
- "Place order" button calls `POST /orders` with `{ tableId, items: [{ menuItemId, quantity, specialRequests? }] }`.
- On `201`: show a success toast, clear the cart, navigate back to `/tables`.
- On error, show inline messaging tied to the error code (see Issue 9).
- Cart state survives navigation between menu and cart, but is cleared on successful order or on logout.

Acceptance criteria
- A real order created from a phone shows up via `GET /orders/:id` on the API.
- Quantity 0 removes the item from the cart instead of submitting `quantity=0`.

---

### Issue 9 — Handle order edge cases (locked / out-of-stock / validation)

**Title:** `feat(waiter-web): handle order error codes (409 locked, 422 out-of-stock, 400)`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p0`

**Body:**

`POST /orders` documents these failure modes (per `docs/Planning/API-Endpoints.md`): `400` validation, `404` table/item missing, `409` table/item/category locked, `422` out-of-stock. The waiter must understand and recover from each.

Scope
- `409 LOCKED_*` → highlight the offending line in the cart, show "This item is no longer available — please remove it."
- `422 OUT_OF_STOCK` → same UX, message "Out of stock."
- `404` → toast "Item or table no longer exists" and refresh the menu/tables list.
- `400` → generic validation message; should not happen if the form is correct.
- All errors should leave the cart intact so the waiter can retry after fixing.

Acceptance criteria
- Locking a menu item from the admin desktop and then trying to order it shows the inline error without losing the rest of the cart.

---

### Issue 10 — "My recent orders" view

**Title:** `feat(waiter-web): my recent orders list`

**Labels:** `area:waiter-web`, `type:feature`, `priority:p1`

**Body:**

Bottom-nav tab "My Orders" showing the waiter's own recent orders via `GET /orders` (server filters to own orders for waiter role).

Scope
- List sorted by `timestamp` descending.
- Each row: time, table name, item count, items summary.
- Tap to expand → full item list from `GET /orders/:orderId`.
- Pull-to-refresh.

Acceptance criteria
- A waiter sees only their own orders, never another waiter's.
- The list updates after placing a new order (without a hard reload).

---

### Issue 11 — Mobile responsiveness + PWA basics

**Title:** `chore(waiter-web): mobile-first polish + installable PWA`

**Labels:** `area:waiter-web`, `type:chore`, `priority:p1`

**Body:**

Make the waiter web feel like a phone app, and let waiters "install" it to home screen.

Scope
- Tap targets ≥ 44px, no hover-only affordances.
- Viewport + iOS safe-area meta tags.
- `manifest.webmanifest` with name, theme color, icons.
- Service worker for offline shell only (do **not** cache API responses — orders must always hit the server).
- Reasonable typography scale and dark-mode-aware colors.

Acceptance criteria
- Lighthouse "Installable" passes on the production build.
- The login → table → menu → order flow is usable one-handed on a 360px-wide screen.

---

## Phase 2 — Admin Desktop (`apps/admin-desktop`)

### Issue 12 — Replace Tauri starter shell with real app shell

**Title:** `chore(admin-desktop): replace Tauri starter with router + layout shell`

**Labels:** `area:admin-desktop`, `type:chore`, `priority:p0`

**Body:**

`apps/admin-desktop/src/App.tsx` is still the "Welcome to Tauri + React" greet demo. Replace it.

Scope
- `react-router-dom` with routes for: `/login` (master), `/events`, `/events/:eventId/admin-login`, and an authenticated admin shell with sub-routes for `/menu`, `/tables`, `/printers`, `/order-displays`, `/users`, `/stock`, `/config`, `/orders`.
- Sidebar layout (left nav, top bar with active event name + passcode display).
- Wrap in `AuthProvider` (Issue 2) using the Tauri token storage adapter, plus `ApiClientProvider` (Issue 1).
- Remove the `greet` invoke command demo and `src-tauri` placeholder code.

Acceptance criteria
- `pnpm --filter admin-desktop dev` starts the Tauri shell with the new layout.
- The greet/Tauri-logo demo is gone.

---

### Issue 13 — Master login + event lifecycle UI

**Title:** `feat(admin-desktop): master login + create / activate / close / delete events`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

The master can only do event lifecycle. Build that UI first because nothing else works without an active event.

Scope
- `/login` for master credentials → `POST /auth/master/login`.
- `/events` page lists all events from the master listing endpoint (or maintain client-side state if there is no list endpoint — check `apps/api/src/routes/admin-events.ts`).
- Create event: `POST /admin/events` with `{ eventName, eventPasscode, adminUsername, adminPassword }`.
- Activate: `POST /admin/events/:eventId/activate`. Show a confirm dialog warning that activating deactivates any currently-active event.
- Deactivate (temporary off): `POST /admin/events/:eventId/deactivate`.
- Close (terminal): `POST /admin/events/:eventId/close` — confirm dialog "this is irreversible".
- Delete: `DELETE /admin/events/:eventId` — confirm dialog "this also removes the event database file".

Acceptance criteria
- A master can create, activate, and close an event end-to-end.
- The currently active event is visually indicated.

---

### Issue 14 — Event passcode display + rotate

**Title:** `feat(admin-desktop): show and rotate event passcode`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

The shared event passcode is what waiters use to log in. The desktop app must display it prominently and let an admin rotate it.

Scope
- A persistent banner / card showing the current passcode (large, monospace) for the active event, fetched via `GET /admin/event-passcode`.
- A "Rotate passcode" button that opens a small modal with a new-value input and calls `PUT /admin/event-passcode`.
- Copy-to-clipboard button.
- Hide the passcode display when there is no active event.

Acceptance criteria
- Anyone holding the laptop can read the passcode without navigating away from their current screen.
- Rotating the passcode invalidates new logins immediately (existing tokens stay valid until expiry — that's acceptable for MVP).

---

### Issue 15 — Admin login (event-scoped)

**Title:** `feat(admin-desktop): event admin login`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

After the master activates an event, the admin for that event needs to log in to manage it.

Scope
- Form: `eventId` (preselected if there's an active event), `username`, `password`.
- Calls `POST /auth/admin/login`.
- On success, store the admin token (separate from the master token) and route to `/menu` (or wherever admin work starts).
- Show `403 FORBIDDEN` clearly when the admin's `eventId` doesn't match the active event ("This admin belongs to a different event").

Acceptance criteria
- An admin can log in for the active event and not for any other event.
- Master and admin tokens coexist (or one replaces the other consistently — pick one and document in the issue PR).

---

### Issue 16 — Menu manager: categories

**Title:** `feat(admin-desktop): menu category CRUD with locking and printer routing`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

CRUD UI for `/menu/categories` with all the fields the API supports.

Scope
- List view: name, description, weight, locked status, assigned printer, assigned order-display.
- Create: `POST /menu/categories` with `{ name, description?, weight?, isLocked?, printerId?, orderDisplayId? }`.
- Edit: `PATCH /menu/categories/:categoryId`. Lock/unlock toggle.
- Delete: `DELETE /menu/categories/:categoryId` — handle the `409` when the category still contains items, with a message guiding the admin to delete or move items first.
- Drag-to-reorder updates `weight`.

Acceptance criteria
- All CRUD verbs and the routing fields are reachable from the UI.
- Locking a category immediately hides its items in the waiter web (verify manually).

---

### Issue 17 — Menu manager: items

**Title:** `feat(admin-desktop): menu item CRUD (with category move and locking)`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

CRUD UI for `/menu/items`.

Scope
- List view filtered by category, sortable by weight or name.
- Create: `POST /menu/items` with `{ name, description?, price, weight?, isLocked?, menuCategoryId }`.
- Edit: `PATCH /menu/items/:menuItemId`. Lock/unlock. Move to a different category by changing `menuCategoryId`.
- Delete: `DELETE /menu/items/:menuItemId`.
- Show stock badge per item if there are stock requirements (linked from Issue 23).

Acceptance criteria
- A locked item disappears from the waiter web menu without a server restart.
- Editing the price changes future orders' prices (note: existing orders are not retroactively repriced — `priceSnapshot` is the deferred backlog item).

---

### Issue 18 — Table manager: CRUD + bulk creation

**Title:** `feat(admin-desktop): table manager (CRUD + bulk create)`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

CRUD UI for `/tables`, including the `POST /tables/bulk` "rows × range" generator.

Scope
- List view with name, weight, locked status.
- Single create: `POST /tables`.
- Bulk create: form with `rows: string[]` (e.g. `A,B,C,D,E`), `from: int`, `to: int`, `lockNew: boolean?` → `POST /tables/bulk`.
- Edit: `PATCH /tables/:tableId` (rename, reweight, lock/unlock).
- Drag-to-reorder updates `weight`.

Acceptance criteria
- Bulk creating `A..E × 1..5` produces 25 tables named `A1` through `E5`.
- Locking a table removes it from the waiter table picker (verify manually).

---

### Issue 19 — Table QR PDF export

**Title:** `feat(admin-desktop): export table QR codes as PDF`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

Wire up the existing `GET /tables/qr.pdf?layout=double|single` endpoint and `GET /tables/:tableId/qr` for single-table QRs.

Scope
- "Export all QR codes" button on the table manager. Layout selector: `double` (default — 2 per page with cut line) or `single` (1 per page).
- Trigger the PDF download from the desktop app (Tauri's file save dialog or open in browser tab).
- Per-table inline QR preview using `GET /tables/:tableId/qr` (PNG/SVG).

Acceptance criteria
- The downloaded PDF prints correctly on A4 in both layouts.
- A waiter can scan a printed QR and land on that table's menu (depends on Issue 6).

---

### Issue 20 — Printer manager + test-print

**Title:** `feat(admin-desktop): printer CRUD with test-print and detailed errors`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

CRUD UI for `/printers` plus a test-print button that surfaces the documented error codes.

Scope
- List, create, edit, delete (handle `409` when a category still references the printer — direct the admin to clear `printerId` on the category first).
- "Test print" button per row → `POST /printers/:printerId/test-print`.
- Map and surface the four documented error codes with their `details.target` and `details.hint`:
  - `PRINTER_CONNECTION_REFUSED`
  - `PRINTER_CONNECTION_TIMEOUT`
  - `PRINTER_HOST_UNREACHABLE`
  - `PRINTER_CONNECTION_FAILED`

Acceptance criteria
- A failing test-print shows the printer's hostname and a one-line hint without exposing a stack trace.
- A successful test-print prints a recognisable test page on the configured device.

---

### Issue 21 — Order-display manager

**Title:** `feat(admin-desktop): order-display CRUD`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p1`

**Body:**

CRUD UI for `/order-displays`. Same shape as printers but without test-print for now.

Scope
- List, create, edit, delete.
- Fields: `name`, `ipAddress`, `connectionDetails`.
- Used as the routing target on `MenuCategory.orderDisplayId` (Issue 16).

Acceptance criteria
- An order display can be created, assigned to a category, and removed when not in use.

---

### Issue 22 — User manager (waiters)

**Title:** `feat(admin-desktop): waiter user manager (list, lock, unlock, delete)`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

Manage waiter identities for the active event.

Scope
- List view of users from `GET /users`, filterable by `locked` and `search`.
- Manual create via `POST /users` (optional — auto-create-on-login already exists).
- Lock / unlock via `PATCH /users/:userId` with `{ isLocked: true|false }`.
- Delete via `DELETE /users/:userId`.

Acceptance criteria
- Locking a waiter prevents them from logging in (server-side enforcement; verify manually).
- The list reflects auto-created users that appeared via the login flow.

---

### Issue 23 — Stock manager + per-item stock requirements

**Title:** `feat(admin-desktop): stock items + menu-item stock requirements`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p1`

**Body:**

CRUD UI for `/stock/items` plus the link table `/menu/items/:menuItemId/stock-requirements`.

Scope
- Stock items: list, create (`name`, `quantity`), edit via `PATCH /stock/items/:stockItemId` supporting both absolute `{ quantity: 42 }` and delta `{ delta: -3 }` updates.
- Menu-item requirements editor: `PUT /menu/items/:menuItemId/stock-requirements` with a `requirements: [{ stockItemId, quantityRequired }]` array (replace semantics).
- Display a low-stock indicator when `quantity` falls below a configurable threshold.

Acceptance criteria
- Setting an item's stock requirement to a depleted stock item makes the waiter web see `422 OUT_OF_STOCK` on order placement (Issue 9).

---

### Issue 24 — Configuration UI

**Title:** `feat(admin-desktop): admin configuration UI`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p1`

**Body:**

Form-based UI over `GET /config` and `PATCH /config`.

Scope
- Render the returned configurations as a list of `name → value` rows.
- Editable single-row patches via `PATCH /config` with `{ values: { key: value } }`.
- Group / annotate well-known keys (event name, low-stock threshold, etc.) — fall back to a generic key/value editor for unknown keys.

Acceptance criteria
- All configurations on the server are visible and editable from the UI.

---

### Issue 25 — Order overview / history

**Title:** `feat(admin-desktop): order history with date filters`

**Labels:** `area:admin-desktop`, `type:feature`, `priority:p0`

**Body:**

The admin needs to see what's happening at the event. Use `GET /orders` with the documented filters.

Scope
- Filter bar: `tableId`, `userId` (waiter), `from`, `to` date-time pickers.
- List view sorted by `timestamp` descending.
- Row expand → details from `GET /orders/:orderId`.
- Auto-refresh every 5 seconds while the screen is open (poll-based; no websocket in MVP).

Acceptance criteria
- An admin can answer "what did table A1 order in the last hour?" without leaving this screen.
- Refresh keeps running in the background without thrashing.

---

## Out of scope (do **not** add to this milestone)

These are explicitly deferred — capture them as separate issues in a different milestone or as a backlog list, but keep them out of MVP.

- **Checkout & receipt** (`POST /orders/:id/checkout`, `GET /orders/:id/receipt`, `GET /orders/:id/receipt.pdf`). Blocked by the missing `priceSnapshot` column on `OrderItems` — the next step is the schema migration before any production event runs. See `docs/Planning/Checkout-Receipt-Followup.md`.
- **Push notifications** (planning section in `API-Endpoints.md`).
- **Live order websocket** — polling is good enough for MVP.
- **German i18n** — UI is English-only for MVP; planning docs stay in German.
- **Server restart endpoint** (`POST /admin/server/restart`) — marked optional in the API plan.
- **Refresh tokens** (`POST /auth/refresh`, `POST /auth/logout`) — current JWT lifetime is acceptable for the length of an event.

---

## Quick stats

- **Total issues:** 25 (2 shared infra + 9 waiter-web + 14 admin-desktop)
- **Blocking the MVP (`priority:p0`):** 19
- **Nice-to-have inside the milestone (`priority:p1`):** 6
- **Suggested order:** Issues 1 → 2 → 3 → 4 → 5 → 7 → 8 → 9 (waiter critical path) → 12 → 13 → 14 → 15 → 18 → 16 → 17 → 22 → 20 → 19 → 25 → remaining `p1`s.
