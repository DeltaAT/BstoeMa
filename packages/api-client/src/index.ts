import { HttpTransport } from "./http.js";
import { createAdminEventsClient, type AdminEventsClient } from "./routes/admin-events.js";
import {
  createAnnouncementsClient,
  type AnnouncementsClient,
} from "./routes/announcements.js";
import { createAuthClient, type AuthClient } from "./routes/auth.js";
import { createConfigClient, type ConfigClient } from "./routes/config.js";
import { createLogsClient, type LogsClient } from "./routes/logs.js";
import { createMenuClient, type MenuClient } from "./routes/menu.js";
import { createOpsClient, type OpsClient } from "./routes/ops.js";
import { createOrdersClient, type OrdersClient } from "./routes/orders.js";
import {
  createOrderDisplaysClient,
  type OrderDisplaysClient,
} from "./routes/order-displays.js";
import { createPrintersClient, type PrintersClient } from "./routes/printers.js";
import { createStockClient, type StockClient } from "./routes/stock.js";
import { createTablesClient, type TablesClient } from "./routes/tables.js";
import { createUsersClient, type UsersClient } from "./routes/users.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type {
  AdminEventsClient,
  AnnouncementsClient,
  AuthClient,
  ConfigClient,
  LogsClient,
  MenuClient,
  OpsClient,
  OrderDisplaysClient,
  OrdersClient,
  PrintersClient,
  StockClient,
  TablesClient,
  UsersClient,
};

export {
  ApiAuthError,
  ApiClientError,
  ApiConflictError,
  ApiForbiddenError,
  ApiNoActiveEventError,
  ApiNotFoundError,
  ApiPrinterError,
  ApiValidationError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ApiClientOptions {
  /** Base URL of the BstöMa API, e.g. `"http://192.168.1.10:8787"`. */
  baseUrl: string;
  /**
   * Called before every request to retrieve the current bearer token.
   * Return `null` to send unauthenticated requests.
   */
  getToken: () => string | null;
  /**
   * Optional recovery hook invoked when a request returns `401` (outside the
   * auth login endpoints). Renew the session and resolve with the fresh bearer
   * token to have the request retried once, or `null` to surface the `401`.
   * Used by waiter-web to silently re-login on token expiry so in-progress
   * work is never lost.
   */
  onUnauthorized?: () => Promise<string | null>;
}

export interface BstoemaApiClient {
  announcements: AnnouncementsClient;
  auth: AuthClient;
  tables: TablesClient;
  menu: MenuClient;
  orders: OrdersClient;
  orderDisplays: OrderDisplaysClient;
  ops: OpsClient;
  users: UsersClient;
  printers: PrintersClient;
  stock: StockClient;
  config: ConfigClient;
  adminEvents: AdminEventsClient;
  logs: LogsClient;
}

export function createApiClient(opts: ApiClientOptions): BstoemaApiClient {
  const http = new HttpTransport(opts);

  return {
    announcements: createAnnouncementsClient(http),
    auth: createAuthClient(http),
    tables: createTablesClient(http),
    menu: createMenuClient(http),
    orders: createOrdersClient(http),
    orderDisplays: createOrderDisplaysClient(http),
    ops: createOpsClient(http),
    users: createUsersClient(http),
    printers: createPrintersClient(http),
    stock: createStockClient(http),
    config: createConfigClient(http),
    adminEvents: createAdminEventsClient(http),
    logs: createLogsClient(http),
  };
}
