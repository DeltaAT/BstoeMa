import { HttpTransport } from "./http.js";
import { createAdminEventsClient, type AdminEventsClient } from "./routes/admin-events.js";
import { createAuthClient, type AuthClient } from "./routes/auth.js";
import { createConfigClient, type ConfigClient } from "./routes/config.js";
import { createMenuClient, type MenuClient } from "./routes/menu.js";
import { createOrdersClient, type OrdersClient } from "./routes/orders.js";
import { createPrintersClient, type PrintersClient } from "./routes/printers.js";
import { createStockClient, type StockClient } from "./routes/stock.js";
import { createTablesClient, type TablesClient } from "./routes/tables.js";
import { createUsersClient, type UsersClient } from "./routes/users.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type {
  AdminEventsClient,
  AuthClient,
  ConfigClient,
  MenuClient,
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
  /** Base URL of the Serva API, e.g. `"http://192.168.1.10:8787"`. */
  baseUrl: string;
  /**
   * Called before every request to retrieve the current bearer token.
   * Return `null` to send unauthenticated requests.
   */
  getToken: () => string | null;
}

export interface ServaApiClient {
  auth: AuthClient;
  tables: TablesClient;
  menu: MenuClient;
  orders: OrdersClient;
  users: UsersClient;
  printers: PrintersClient;
  stock: StockClient;
  config: ConfigClient;
  adminEvents: AdminEventsClient;
}

export function createApiClient(opts: ApiClientOptions): ServaApiClient {
  const http = new HttpTransport(opts);

  return {
    auth: createAuthClient(http),
    tables: createTablesClient(http),
    menu: createMenuClient(http),
    orders: createOrdersClient(http),
    users: createUsersClient(http),
    printers: createPrintersClient(http),
    stock: createStockClient(http),
    config: createConfigClient(http),
    adminEvents: createAdminEventsClient(http),
  };
}
