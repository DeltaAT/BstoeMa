import {
  OrderDisplayCreateRequestSchema,
  OrderDisplayCreateResponseSchema,
  OrderDisplayGetResponseSchema,
  OrderDisplaysResponseSchema,
  OrderDisplayUpdateRequestSchema,
  OrderDisplayUpdateResponseSchema,
  type OrderDisplayCreateRequest,
  type OrderDisplayCreateResponse,
  type OrderDisplayGetResponse,
  type OrderDisplaysResponse,
  type OrderDisplayUpdateRequest,
  type OrderDisplayUpdateResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface OrderDisplaysClient {
  list(): Promise<OrderDisplaysResponse>;
  create(body: OrderDisplayCreateRequest): Promise<OrderDisplayCreateResponse>;
  getById(orderDisplayId: number): Promise<OrderDisplayGetResponse>;
  update(
    orderDisplayId: number,
    body: OrderDisplayUpdateRequest
  ): Promise<OrderDisplayUpdateResponse>;
  delete(orderDisplayId: number): Promise<void>;
}

export function createOrderDisplaysClient(http: HttpTransport): OrderDisplaysClient {
  return {
    list: () => http.get(OrderDisplaysResponseSchema, "/order-displays"),

    create: (body) =>
      http.post(
        OrderDisplayCreateResponseSchema,
        "/order-displays",
        OrderDisplayCreateRequestSchema.parse(body)
      ),

    getById: (orderDisplayId) =>
      http.get(OrderDisplayGetResponseSchema, `/order-displays/${orderDisplayId}`),

    update: (orderDisplayId, body) =>
      http.patch(
        OrderDisplayUpdateResponseSchema,
        `/order-displays/${orderDisplayId}`,
        OrderDisplayUpdateRequestSchema.parse(body)
      ),

    delete: (orderDisplayId) => http.deleteVoid(`/order-displays/${orderDisplayId}`),
  };
}
