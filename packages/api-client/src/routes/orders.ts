import {
  OrderGetResponseSchema,
  OrderPrintResponseSchema,
  OrdersResponseSchema,
  OrderSubmitRequestSchema,
  OrderSubmitResponseSchema,
  type OrderGetResponse,
  type OrderPrintResponse,
  type OrdersQuery,
  type OrdersResponse,
  type OrderSubmitRequest,
  type OrderSubmitResponse,
} from "@serva/shared-types";
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
  };
}
