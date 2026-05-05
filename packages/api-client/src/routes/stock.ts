import {
  MenuItemStockRequirementsReplaceRequestSchema,
  MenuItemStockRequirementsReplaceResponseSchema,
  StockItemCreateRequestSchema,
  StockItemCreateResponseSchema,
  StockItemsResponseSchema,
  StockItemUpdateRequestSchema,
  StockItemUpdateResponseSchema,
  type MenuItemStockRequirementsReplaceRequest,
  type MenuItemStockRequirementsReplaceResponse,
  type StockItemCreateRequest,
  type StockItemCreateResponse,
  type StockItemsResponse,
  type StockItemUpdateRequest,
  type StockItemUpdateResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface StockClient {
  listItems(): Promise<StockItemsResponse>;
  createItem(body: StockItemCreateRequest): Promise<StockItemCreateResponse>;
  /** Update quantity via absolute value (`quantity`) or relative change (`delta`). */
  updateItem(stockItemId: number, body: StockItemUpdateRequest): Promise<StockItemUpdateResponse>;
  /** Fetch current stock requirements for a menu item. */
  getMenuItemRequirements(menuItemId: number): Promise<MenuItemStockRequirementsReplaceResponse>;
  /** Replace all stock requirements for a menu item in one atomic operation. */
  replaceMenuItemRequirements(
    menuItemId: number,
    body: MenuItemStockRequirementsReplaceRequest,
  ): Promise<MenuItemStockRequirementsReplaceResponse>;
}

export function createStockClient(http: HttpTransport): StockClient {
  return {
    listItems: () =>
      http.get(StockItemsResponseSchema, "/stock/items"),

    createItem: (body) =>
      http.post(
        StockItemCreateResponseSchema,
        "/stock/items",
        StockItemCreateRequestSchema.parse(body),
      ),

    updateItem: (stockItemId, body) =>
      http.patch(
        StockItemUpdateResponseSchema,
        `/stock/items/${stockItemId}`,
        StockItemUpdateRequestSchema.parse(body),
      ),

    getMenuItemRequirements: (menuItemId) =>
      http.get(
        MenuItemStockRequirementsReplaceResponseSchema,
        `/menu/items/${menuItemId}/stock-requirements`,
      ),

    replaceMenuItemRequirements: (menuItemId, body) =>
      http.put(
        MenuItemStockRequirementsReplaceResponseSchema,
        `/menu/items/${menuItemId}/stock-requirements`,
        MenuItemStockRequirementsReplaceRequestSchema.parse(body),
      ),
  };
}
