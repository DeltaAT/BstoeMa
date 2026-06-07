import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import selfsigned from "selfsigned";

export type EnsureCertResult = {
  certFile: string;
  keyFile: string;
  /** True when a fresh cert was written on this call. */
  generated: boolean;
  /** LAN IPv4 addresses baked into the cert as SANs. */
  ips: string[];
};

/** Regenerate when the cert expires within this window, so phones never hit a
 *  cert that lapses mid-event. */
const RENEW_BEFORE_DAYS = 30;

/** Non-internal IPv4 addresses of this machine — what phones use to reach us. */
function lanIps(): string[] {
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

/** True if the existing cert is still valid and already covers every current
 *  LAN IP — i.e. we can reuse it instead of regenerating. */
function certCovers(certPem: string, requiredIps: string[]): boolean {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    return false;
  }

  const renewCutoff = new Date();
  renewCutoff.setDate(renewCutoff.getDate() + RENEW_BEFORE_DAYS);
  if (new Date(cert.validTo) <= renewCutoff) return false;

  // subjectAltName looks like: "DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.5"
  const san = cert.subjectAltName ?? "";
  return requiredIps.every((ip) => san.includes(`IP Address:${ip}`));
}

async function writeCert(
  certDir: string,
  ips: string[],
): Promise<{ cert: string; key: string }> {
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
  return { cert: certFile, key: keyFile };
}

/**
 * Guarantees a usable self-signed TLS cert exists in `certDir`, returning the
 * file paths. Reuses the cert on disk when it's still valid and already covers
 * the machine's current LAN IPs; otherwise (missing, expiring, or the IP
 * changed — e.g. a new DHCP lease) it generates a fresh one. This is what lets
 * the shipped Tauri build serve HTTPS — and thus live camera / QR scanning —
 * without any manual cert step.
 */
export async function ensureCert(certDir: string): Promise<EnsureCertResult> {
  mkdirSync(certDir, { recursive: true });
  const certFile = resolve(certDir, "cert.pem");
  const keyFile = resolve(certDir, "key.pem");
  const ips = lanIps();
  const requiredIps = ["127.0.0.1", ...ips];

  if (existsSync(certFile) && existsSync(keyFile)) {
    try {
      if (certCovers(readFileSync(certFile, "utf8"), requiredIps)) {
        return { certFile, keyFile, generated: false, ips };
      }
    } catch {
      // Unreadable cert — fall through and regenerate.
    }
  }

  const written = await writeCert(certDir, ips);
  return { certFile: written.cert, keyFile: written.key, generated: true, ips };
}
