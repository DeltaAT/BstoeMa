import {
  MenuCategoriesResponseSchema,
  MenuCategoryCreateRequestSchema,
  MenuCategoryCreateResponseSchema,
  MenuCategoryUpdateRequestSchema,
  MenuCategoryUpdateResponseSchema,
  MenuItemCreateRequestSchema,
  MenuItemCreateResponseSchema,
  MenuItemsResponseSchema,
  MenuItemUpdateRequestSchema,
  MenuItemUpdateResponseSchema,
  MenuExportSchema,
  MenuImportRequestSchema,
  MenuImportResponseSchema,
  type MenuCategoriesQuery,
  type MenuCategoriesResponse,
  type MenuCategoryCreateRequest,
  type MenuCategoryCreateResponse,
  type MenuCategoryUpdateRequest,
  type MenuCategoryUpdateResponse,
  type MenuExport,
  type MenuImportRequest,
  type MenuImportResponse,
  type MenuItemCreateRequest,
  type MenuItemCreateResponse,
  type MenuItemsQuery,
  type MenuItemsResponse,
  type MenuItemUpdateRequest,
  type MenuItemUpdateResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface MenuClient {
  listCategories(query?: MenuCategoriesQuery): Promise<MenuCategoriesResponse>;
  createCategory(body: MenuCategoryCreateRequest): Promise<MenuCategoryCreateResponse>;
  updateCategory(categoryId: number, body: MenuCategoryUpdateRequest): Promise<MenuCategoryUpdateResponse>;
  deleteCategory(categoryId: number): Promise<void>;
  listItems(query?: MenuItemsQuery): Promise<MenuItemsResponse>;
  createItem(body: MenuItemCreateRequest): Promise<MenuItemCreateResponse>;
  updateItem(menuItemId: number, body: MenuItemUpdateRequest): Promise<MenuItemUpdateResponse>;
  deleteItem(menuItemId: number): Promise<void>;
  exportMenu(): Promise<MenuExport>;
  importMenu(body: MenuImportRequest): Promise<MenuImportResponse>;
}

export function createMenuClient(http: HttpTransport): MenuClient {
  return {
    listCategories: (query) =>
      http.get(MenuCategoriesResponseSchema, "/menu/categories", {
        locked: query?.locked,
        includeRouting: query?.includeRouting,
      }),

    createCategory: (body) =>
      http.post(
        MenuCategoryCreateResponseSchema,
        "/menu/categories",
        MenuCategoryCreateRequestSchema.parse(body),
      ),

    updateCategory: (categoryId, body) =>
      http.patch(
        MenuCategoryUpdateResponseSchema,
        `/menu/categories/${categoryId}`,
        MenuCategoryUpdateRequestSchema.parse(body),
      ),

    deleteCategory: (categoryId) =>
      http.deleteVoid(`/menu/categories/${categoryId}`),

    listItems: (query) =>
      http.get(MenuItemsResponseSchema, "/menu/items", {
        categoryId: query?.categoryId,
        locked: query?.locked,
        sort: query?.sort,
      }),

    createItem: (body) =>
      http.post(
        MenuItemCreateResponseSchema,
        "/menu/items",
        MenuItemCreateRequestSchema.parse(body),
      ),

    updateItem: (menuItemId, body) =>
      http.patch(
        MenuItemUpdateResponseSchema,
        `/menu/items/${menuItemId}`,
        MenuItemUpdateRequestSchema.parse(body),
      ),

    deleteItem: (menuItemId) =>
      http.deleteVoid(`/menu/items/${menuItemId}`),

    exportMenu: () => http.get(MenuExportSchema, "/menu/export"),

    importMenu: (body) =>
      http.post(
        MenuImportResponseSchema,
        "/menu/import",
        MenuImportRequestSchema.parse(body),
      ),
  };
}
