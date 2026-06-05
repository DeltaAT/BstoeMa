import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import selfsigned from "selfsigned";

function lanIps(): string[] {
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

const certDir = resolve(process.cwd(), "tls");
mkdirSync(certDir, { recursive: true });

const ips = lanIps();
const altNames = [
  { type: 2 as const, value: "localhost" },
  { type: 7 as const, ip: "127.0.0.1" },
  ...ips.map((ip) => ({ type: 7 as const, ip })),
];

const notBeforeDate = new Date();
const notAfterDate = new Date();
// Apple requires TLS server certificates issued on/after 2020-09-01 to have a
// validity period of 398 days or fewer. iOS (Safari and Chrome) reject longer
// certs during the handshake — surfaced as ERR_SSL_PROTOCOL_ERROR / "cannot
// establish a secure connection" — even though desktop browsers only show a
// click-through warning. Stay safely under the limit so phones can connect.
// https://support.apple.com/en-us/HT211025
notAfterDate.setDate(notAfterDate.getDate() + 397);

const pems = await selfsigned.generate(
  [{ name: "commonName", value: "Serva Local" }],
  {
    notBeforeDate,
    notAfterDate,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "subjectAltName", altNames },
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
    ],
  },
);

const certFile = resolve(certDir, "cert.pem");
const keyFile = resolve(certDir, "key.pem");
writeFileSync(certFile, pems.cert);
writeFileSync(keyFile, pems.private);

console.log(`Wrote ${certFile}`);
console.log(`Wrote ${keyFile}`);
console.log(`SANs: localhost, 127.0.0.1${ips.length ? ", " + ips.join(", ") : ""}`);
