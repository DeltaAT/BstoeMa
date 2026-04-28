import {
  OrderGetResponseSchema,
  OrdersResponseSchema,
  OrderSubmitRequestSchema,
  OrderSubmitResponseSchema,
  type OrderGetResponse,
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
  };
}
