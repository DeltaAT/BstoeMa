import {
  HostInfoResponseSchema,
  type HostInfoResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface OpsClient {
  /** Host network info — LAN IP and ports — used to build waiter QR links. */
  hostInfo(): Promise<HostInfoResponse>;
}

export function createOpsClient(http: HttpTransport): OpsClient {
  return {
    hostInfo: () => http.get(HostInfoResponseSchema, "/host-info"),
  };
}
