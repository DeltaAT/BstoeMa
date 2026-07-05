import { createSocket } from "node:dgram";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { HostInfoResponseSchema } from "@bstoema/shared-types";

/**
 * Asks the OS which local IPv4 it would use to reach a public internet
 * address. We open a UDP socket and `connect()` it to 8.8.8.8 — no packets
 * are sent, but the kernel binds the socket to whichever interface the
 * default route points at, which is exactly the address phones on the same
 * Wi-Fi will be able to reach.
 *
 * Returns null on any error (offline, no default route, IPv6-only host etc.).
 */
function probeDefaultRouteIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const finish = (value: string | null) => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(value);
    };
    socket.once("error", () => finish(null));
    try {
      socket.connect(80, "8.8.8.8", () => {
        try {
          const addr = socket.address();
          finish(addr?.address ?? null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Fallback heuristic when the UDP probe is unavailable. Prefers private LAN
 * ranges (10/8, 172.16/12, 192.168/16) and skips APIPA link-local addresses
 * (169.254/16) which Windows assigns to disconnected adapters.
 */
function pickBestInterfaceIp(): string {
  const candidates: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue;
    for (const net of iface) {
      if (net.family === "IPv4" && !net.internal) {
        candidates.push(net.address);
      }
    }
  }

  const isPrivateLan = (ip: string) => {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };
  const isLinkLocal = (ip: string) => ip.startsWith("169.254.");

  return (
    candidates.find(isPrivateLan) ??
    candidates.find((ip) => !isLinkLocal(ip)) ??
    candidates[0] ??
    "127.0.0.1"
  );
}

/**
 * Returns the best-guess LAN IPv4 of the host.
 *   1. `BSTOEMA_HOST_IP` env var (manual override — set this when the host has
 *      multiple LANs and auto-detect picks the wrong one, e.g. a VPN tunnel).
 *   2. OS default-route lookup (works for the typical single-LAN setup).
 *   3. Static heuristic over `os.networkInterfaces()`.
 */
async function getLocalIp(): Promise<string> {
  const override = process.env.BSTOEMA_HOST_IP?.trim();
  if (override) return override;

  const probed = await probeDefaultRouteIp();
  if (probed && probed !== "0.0.0.0" && !probed.startsWith("169.254.")) {
    return probed;
  }
  return pickBestInterfaceIp();
}

export function registerOpsRoutes(app: FastifyInstance) {
  app.get(
    "/host-info",
    {
      schema: {
        tags: ["ops"],
        operationId: "getHostInfo",
        summary: "Host-Netzwerkinfo",
        description:
          "Gibt die erste nicht-lokale IPv4-Adresse des Servers zurueck. " +
          "Wird vom Admin-Frontend verwendet, um QR-Codes mit der echten LAN-IP zu generieren.",
        response: {
          200: HostInfoResponseSchema,
        },
      },
    },
    async () => {
      const localIp = await getLocalIp();
      const httpPort = Number(process.env.PORT || 8787);
      const httpsPort = Number(process.env.HTTPS_PORT || 8443);
      const certDir = resolve(process.cwd(), "tls");
      const httpsEnabled =
        existsSync(resolve(certDir, "cert.pem")) &&
        existsSync(resolve(certDir, "key.pem"));
      return {
        localIp,
        httpPort,
        ...(httpsEnabled ? { httpsPort } : {}),
      };
    }
  );
}

