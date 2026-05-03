import { networkInterfaces } from "node:os";
import type { FastifyInstance } from "fastify";
import { HostInfoResponseSchema } from "@serva/shared-types";

/**
 * Returns the first non-loopback IPv4 address found on the host, or
 * "127.0.0.1" as a safe fallback when no LAN interface is available.
 */
function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const net of iface) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
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
    async () => ({ localIp: getLocalIp() })
  );
}

