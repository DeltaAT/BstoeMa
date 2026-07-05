/**
 * BstöMa Waiter — offline app-shell service worker.
 *
 * Caches only the static shell (HTML, JS, CSS, icons). API requests
 * (orders, menu, auth, etc.) MUST always reach the operator laptop —
 * a stale order is worse than no order — so they bypass the cache and
 * the SW never inspects them. In production this is structurally
 * guaranteed: the SW is served from /waiter/sw.js with scope /waiter/,
 * so API paths like /orders, /auth, /menu fall outside its scope
 * entirely. The runtime check below is a belt-and-braces guard for
 * dev/preview where scope is the origin root.
 */

const CACHE_VERSION = "bstoema-waiter-v1";
const SHELL_PATHS = ["./", "./manifest.webmanifest", "./icon-512.png", "./favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Best-effort: a missing optional asset must not block install.
      Promise.allSettled(SHELL_PATHS.map((p) => cache.add(p)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// Paths that are always API calls — never cache, never serve from cache.
// Keep in sync with the route groups registered in apps/api/src/app.ts.
const API_PREFIXES = [
  "/auth",
  "/tables",
  "/menu",
  "/orders",
  "/users",
  "/printers",
  "/stock",
  "/config",
  "/admin",
  "/host-info",
];

function isApiRequest(url) {
  return API_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin → let the network handle it.
  if (url.origin !== self.location.origin) return;

  // API → never touch.
  if (isApiRequest(url)) return;

  // SPA navigations: network-first so a fresh build wins, fall back to
  // the cached shell when the laptop/AP is unreachable.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put("./", fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          const cached = (await cache.match("./")) || (await cache.match(req));
          if (cached) return cached;
          return new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // Hashed build assets (/waiter/assets/*) and icons → cache-first.
  // Vite emits content-hashed filenames, so a cached asset is immutable.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok && fresh.type === "basic") {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
