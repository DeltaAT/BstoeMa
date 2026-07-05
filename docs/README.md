# BstöMa documentation

Start at the [project README](../README.md) for the overview, then dive in here.

## Guides

- **[Getting Started](getting-started.md)** — install prerequisites, run the stack in
  dev, reach the apps from real phones over HTTPS, and troubleshoot common issues.
- **[Architecture](architecture.md)** — how the pieces fit together: the operator-laptop
  model, the two-database design, the store pattern, route guards, and the
  shared-types contract.
- **[API Guide](api.md)** — authentication roles and flows, the endpoint reference, and
  the error model. The live, always-accurate reference is the Swagger UI at
  `/documentation` when the API is running.

## Per-workspace docs

- [`apps/api`](../apps/api/README.md) — backend, auth, event lifecycle, smoke test
- [`apps/waiter-web`](../apps/waiter-web/README.md) — waiter PWA
- [`apps/admin-desktop`](../apps/admin-desktop/README.md) — operator desktop app
- [`packages/shared-types`](../packages/shared-types/README.md) — Zod schemas & types

## Design & planning

The [`Planning/`](Planning) folder holds the original design material — API endpoint
notes, ER/class diagrams, MVVM notes, mindmaps, and the MVP milestone breakdown. It
documents intent and history; the guides above describe the system as built.
