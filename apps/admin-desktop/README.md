# admin-desktop

The operator's desktop app for Serva, built with **Tauri v2** + React 19 + Vite. The
operator uses it to create and activate events, manage the menu/tables/users/printers,
and watch incoming orders. It talks to the Serva API through `@serva/api-client`.

See the repo [README](../../README.md) and [docs](../../docs) for the big picture.

## Prerequisites

In addition to the repo prerequisites, this app needs the **Rust toolchain** and the
Tauri system dependencies — follow the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (on Windows:
WebView2 runtime + MSVC C++ build tools).

## Configure

```bash
cp .env.example .env     # set VITE_API_BASE_URL to the API origin (default http://localhost:8787)
```

## Develop

```bash
# from the repo root, once: build the shared packages this app imports
pnpm build

# desktop app (native window, hot reload)
pnpm --filter appsadmin-desktop tauri dev

# or just the web layer in a browser (no native shell)
pnpm --filter appsadmin-desktop dev
```

> The workspace package name is `appsadmin-desktop` (used with `--filter`).

## Build

```bash
pnpm --filter appsadmin-desktop tauri build      # production desktop bundle
```

From the repo root, `pnpm tauri:build` builds the shared packages + waiter PWA first,
then the desktop bundle.

## Test

```bash
pnpm --filter appsadmin-desktop test:e2e         # Playwright
```
