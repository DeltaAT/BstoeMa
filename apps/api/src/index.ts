import "dotenv/config";
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app";
import { startPrintQueueWorker } from "./domain/print-queue-worker";
import { printerStore } from "./domain/state";
import { ensureCert } from "./tls/ensure-cert";

const port = Number(process.env.PORT || 8787);
const httpsPort = Number(process.env.HTTPS_PORT || 8443);
const host = process.env.HOST || "0.0.0.0";

// A self-signed cert is generated on first boot (and refreshed if it expires or
// the LAN IP changes) into a `tls/` folder next to the API's working dir, so the
// shipped build serves HTTPS with no manual step — phones need a secure context
// for live camera / QR scanning. Set BSTOEMA_DISABLE_HTTPS=1 to opt out.
const certDir = resolve(process.cwd(), "tls");
let certFile = "";
let keyFile = "";
let httpsEnabled = false;
if (process.env.BSTOEMA_DISABLE_HTTPS !== "1") {
  try {
    const result = await ensureCert(certDir);
    certFile = result.certFile;
    keyFile = result.keyFile;
    httpsEnabled = true;
    if (result.generated) {
      console.log(
        `TLS cert generated for: localhost, 127.0.0.1${result.ips.length ? ", " + result.ips.join(", ") : ""}`,
      );
    }
  } catch (err) {
    console.error("Failed to prepare TLS cert — starting HTTP only:", err);
  }
}

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

// Retry offline-printer bons in the background: anything queued while a printer
// was down is delivered automatically once it comes back online (issue #130).
// Both the worker start and its onClose hook must run BEFORE listen — Fastify
// throws FST_ERR_INSTANCE_ALREADY_LISTENING for addHook on a started instance,
// which crashed the whole API right after boot (broken login in the desktop app).
const stopPrintQueueWorker = startPrintQueueWorker(printerStore, { logger: app.log });
app.addHook("onClose", async () => {
  stopPrintQueueWorker();
});

if (httpsEnabled) {
  await app.listen({ port: httpsPort, host });
  console.log(`API (HTTPS) https://${host}:${httpsPort}`);
} else {
  await app.listen({ port, host });
  console.log(`API running on http://${host}:${port}`);
  console.log(
    "HTTPS disabled (BSTOEMA_DISABLE_HTTPS=1 or cert error) — phones can't use the live camera without it.",
  );
}
console.log(
  `Swagger UI available at http${httpsEnabled ? "s" : ""}://${host}:${httpsEnabled ? httpsPort : port}/documentation`,
);
