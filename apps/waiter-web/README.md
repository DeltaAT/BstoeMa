# waiter-web

The waiter PWA for Serva — a phone-first React app waiters use to scan a table's QR
code, browse the menu, and send orders to the kitchen. In production the Serva API
serves this app's build output at `/waiter/`.

See the repo [README](../../README.md) and [docs](../../docs) for the big picture.

## Develop

```bash
# from the repo root, once: build the shared packages this app imports
pnpm build

pnpm --filter waiter-web dev      # Vite dev server → http://localhost:5173/waiter/
```

The app is namespaced under `/waiter/` (Vite `base`), so its client routes never collide
with API route paths. API calls use root-absolute paths (`/auth`, `/orders`, …) and are
proxied to the API on `:8787` by `vite.config.ts`.

Set `VITE_API_BASE_URL` to point at a non-default API origin (defaults to same-origin,
which works with the dev proxy and with the production build served by the API).

## Build & serve to phones

```bash
pnpm --filter waiter-web build    # outputs dist/ (base /waiter/)
```

The API auto-detects `apps/waiter-web/dist` and serves it at `/waiter/`, with an
`index.html` fallback for deep-link reloads. For phone use you'll want the API running
over HTTPS (the camera/QR scanner needs a secure context) — see
[docs/getting-started.md → Running on phones](../../docs/getting-started.md#running-on-phones-https).

## Test & lint

```bash
pnpm --filter waiter-web test:e2e   # Playwright; boots the API + Vite automatically
pnpm --filter waiter-web lint
```

## Layout

- `src/pages/*` — Tables, Menu, Order, Orders, Login screens
- `src/contexts/*` — cart state (`CartContext`) and API client wiring
- `src/components/*` — shared UI (layout shell, error boundary)
- `e2e/*` — Playwright specs
