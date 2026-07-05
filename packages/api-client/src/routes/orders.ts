import {
  OrderGetResponseSchema,
  OrderPrintResponseSchema,
  OrdersExportResponseSchema,
  OrdersResponseSchema,
  OrderSubmitRequestSchema,
  OrderSubmitResponseSchema,
  type OrderGetResponse,
  type OrderPrintResponse,
  type OrdersExportResponse,
  type OrdersQuery,
  type OrdersResponse,
  type OrderSubmitRequest,
  type OrderSubmitResponse,
} from "@bstoema/shared-types";
import type { HttpTransport } from "../http.js";

export interface OrdersClient {
  list(query?: OrdersQuery): Promise<OrdersResponse>;
  create(body: OrderSubmitRequest): Promise<OrderSubmitResponse>;
  getById(orderId: number): Promise<OrderGetResponse>;
  /**
   * Trigger printing of an order's bons. The API groups items by their
   * category's assigned printer and returns one result per printer. A failed
   * printer doesn't fail the call — inspect `results[].status` instead.
   */
  print(orderId: number): Promise<OrderPrintResponse>;
  /**
   * Flat, denormalized dump of every order line of the active event (one row
   * per order item, names already joined) for offline analysis. Admin only.
   */
  exportData(): Promise<OrdersExportResponse>;
}

export function createOrdersClient(http: HttpTransport): OrdersClient {
  return {
    list: (query) =>
      http.get(OrdersResponseSchema, "/orders", {
        tableId: query?.tableId,
        userId: query?.userId,
        from: query?.from,
        to: query?.to,
      }),

    create: (body) =>
      http.post(
        OrderSubmitResponseSchema,
        "/orders",
        OrderSubmitRequestSchema.parse(body),
      ),

    getById: (orderId) =>
      http.get(OrderGetResponseSchema, `/orders/${orderId}`),

    print: (orderId) =>
      http.post(OrderPrintResponseSchema, `/orders/${orderId}/print`),

    exportData: () => http.get(OrdersExportResponseSchema, "/orders/export"),
  };
}
