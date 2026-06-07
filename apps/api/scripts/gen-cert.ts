import { resolve } from "node:path";
import { ensureCert } from "../src/tls/ensure-cert";

// Manual cert generation for dev / explicit pre-seeding. The API also calls
// ensureCert() on startup, so this is only needed when you want the cert created
// up front (e.g. to inspect it or install it on a device before launch).
const certDir = resolve(process.cwd(), "tls");
const { certFile, keyFile, generated, ips } = await ensureCert(certDir);

console.log(generated ? `Wrote ${certFile}` : `Reused existing ${certFile}`);
console.log(generated ? `Wrote ${keyFile}` : `Reused existing ${keyFile}`);
console.log(
  `SANs: localhost, 127.0.0.1${ips.length ? ", " + ips.join(", ") : ""}`,
);
