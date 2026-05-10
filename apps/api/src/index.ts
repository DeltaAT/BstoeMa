import "dotenv/config";
import http from "node:http";
import https from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app";

const port = Number(process.env.PORT || 8787);
const httpsPort = Number(process.env.HTTPS_PORT || 8443);
const host = process.env.HOST || "0.0.0.0";

// Cert files are written by `pnpm --filter api gen-cert` into apps/api/tls/.
// Resolve relative to cwd so the dev server (cwd = apps/api) and the built
// dist/index.js (cwd = apps/api) both find them.
const certDir = resolve(process.cwd(), "tls");
const certFile = resolve(certDir, "cert.pem");
const keyFile = resolve(certDir, "key.pem");

const httpsEnabled = existsSync(certFile) && existsSync(keyFile);

const app = await buildApp(
  httpsEnabled
    ? {
        // Fastify creates the HTTPS server (the "main" listener) and we also
        // start a plain HTTP server on the same request handler for backwards
        // compatibility with admin-desktop and any clients that still use HTTP.
        serverFactory: (handler) => {
          const httpServer = http.createServer(handler);
          httpServer.listen(port, host, () => {
            console.log(`API (HTTP)  http://${host}:${port}`);
          });
          return https.createServer(
            {
              key: readFileSync(keyFile),
              cert: readFileSync(certFile),
            },
            handler,
          );
        },
      }
    : undefined,
);

if (httpsEnabled) {
  await app.listen({ port: httpsPort, host });
  console.log(`API (HTTPS) https://${host}:${httpsPort}`);
} else {
  await app.listen({ port, host });
  console.log(`API running on http://${host}:${port}`);
  console.log(
    "HTTPS disabled — run `pnpm --filter api gen-cert` to enable camera access on phones.",
  );
}
console.log(
  `Swagger UI available at http${httpsEnabled ? "s" : ""}://${host}:${httpsEnabled ? httpsPort : port}/documentation`,
);
