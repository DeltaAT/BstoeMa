import { z } from "zod";

const positiveInt = z.number().int().positive();
const nonEmptyString = z.string().trim().min(1);

export const ConfigurationsSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    value: z.string(),
  })
  .strict();
export type Configurations = z.infer<typeof ConfigurationsSchema>;

export const UsersSchema = z
  .object({
    id: positiveInt,
    username: nonEmptyString,
    isLocked: z.boolean(),
  })
  .strict();
export type Users = z.infer<typeof UsersSchema>;

export const PrintersSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    ipAddress: z.string(),
    connectionDetails: z.string(),
  })
  .strict();
export type Printers = z.infer<typeof PrintersSchema>;

export const OrderDisplaysSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    ipAddress: z.string(),
    connectionDetails: z.string(),
  })
  .strict();
export type OrderDisplays = z.infer<typeof OrderDisplaysSchema>;

export const TablesSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    weight: z.number().int(),
    isLocked: z.boolean(),
  })
  .strict();
export type Tables = z.infer<typeof TablesSchema>;

export const MenuCategoriesSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    description: z.string(),
    isLocked: z.boolean(),
    weight: z.number().int(),
    printer_id: positiveInt,
    orderDisplay_id: positiveInt,
  })
  .strict();
export type MenuCategories = z.infer<typeof MenuCategoriesSchema>;

export const MenuItemsSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    description: z.string(),
    weight: z.number().int(),
    price: z.number().nonnegative(),
    isLocked: z.boolean(),
    menuCategory_id: positiveInt,
  })
  .strict();
export type MenuItems = z.infer<typeof MenuItemsSchema>;

export const StockItemsSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    quantity: z.number().int().nonnegative(),
  })
  .strict();
export type StockItems = z.infer<typeof StockItemsSchema>;

export const StockItemMenuItemSchema = z
  .object({
    stockItem_id: positiveInt,
    menuItem_id: positiveInt,
    quantityRequired: z.number().int().positive(),
  })
  .strict();
export type StockItemMenuItem = z.infer<typeof StockItemMenuItemSchema>;

export const OrdersSchema = z
  .object({
    id: positiveInt,
    timestamp: z.string().datetime(),
    table_id: positiveInt,
    user_id: positiveInt,
  })
  .strict();
export type Orders = z.infer<typeof OrdersSchema>;

export const OrderItemsSchema = z
  .object({
    order_id: positiveInt,
    menuItem_id: positiveInt,
    quantity: z.number().int().positive(),
    specialRequests: z.string(),
  })
  .strict();
export type OrderItems = z.infer<typeof OrderItemsSchema>;

export const UserDtoSchema = z
  .object({
    id: positiveInt,
    username: nonEmptyString,
    isLocked: z.boolean(),
  })
  .strict();
export type UserDto = z.infer<typeof UserDtoSchema>;

export const TableDtoSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    weight: z.number().int(),
    isLocked: z.boolean(),
  })
  .strict();
export type TableDto = z.infer<typeof TableDtoSchema>;

export const TablesQuerySchema = z
  .object({
    locked: z
      .union([z.boolean(), z.string().trim().toLowerCase()])
      .transform((value, ctx) => {
        if (typeof value === "boolean") {
          return value;
        }

        if (value === "true") {
          return true;
        }

        if (value === "false") {
          return false;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected true or false",
        });
        return z.NEVER;
      })
      .optional()
      .describe("Filter by lock state. Example: ?locked=false"),
    sort: z
      .literal("weight,name")
      .optional()
      .describe("Supported sort key. Example: ?sort=weight,name"),
  })
  .strict();
export type TablesQuery = z.infer<typeof TablesQuerySchema>;

export const TableCreateRequestSchema = z
  .object({
    name: nonEmptyString,
    weight: z.number().int().optional(),
    isLocked: z.boolean().optional(),
  })
  .strict();
export type TableCreateRequest = z.infer<typeof TableCreateRequestSchema>;

export const TableBulkCreateRequestSchema = z
  .object({
    rows: z.array(nonEmptyString).min(1),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    lockNew: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.to >= value.from, {
    message: "to must be greater than or equal to from",
    path: ["to"],
  });
export type TableBulkCreateRequest = z.infer<typeof TableBulkCreateRequestSchema>;

export const TableUpdateRequestSchema = z
  .object({
    name: nonEmptyString.optional(),
    weight: z.number().int().optional(),
    isLocked: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type TableUpdateRequest = z.infer<typeof TableUpdateRequestSchema>;

export const TableParamsSchema = z
  .object({
    tableId: z.coerce.number().int().positive(),
  })
  .strict();
export type TableParams = z.infer<typeof TableParamsSchema>;

export const TablesResponseSchema = z
  .object({
    tables: z.array(TableDtoSchema),
  })
  .strict();
export type TablesResponse = z.infer<typeof TablesResponseSchema>;

export const TableCreateResponseSchema = TableDtoSchema;
export type TableCreateResponse = TableDto;

export const TableBulkCreateResponseSchema = z
  .object({
    tables: z.array(TableDtoSchema),
  })
  .strict();
export type TableBulkCreateResponse = z.infer<typeof TableBulkCreateResponseSchema>;

export const TableUpdateResponseSchema = TableDtoSchema;
export type TableUpdateResponse = TableDto;

const optionalBooleanQuerySchema = z
  .union([z.boolean(), z.string().trim().toLowerCase()])
  .transform((value, ctx) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected true or false",
    });
    return z.NEVER;
  });

export const UsersQuerySchema = z
  .object({
    locked: optionalBooleanQuerySchema
      .optional()
      .describe("Filter by lock state. Example: ?locked=true"),
    search: z.string().trim().min(1).max(120).optional().describe("Case-insensitive username search"),
  })
  .strict();
export type UsersQuery = z.infer<typeof UsersQuerySchema>;

export const UserParamsSchema = z
  .object({
    userId: z.coerce.number().int().positive(),
  })
  .strict();
export type UserParams = z.infer<typeof UserParamsSchema>;

export const UserCreateRequestSchema = z
  .object({
    username: nonEmptyString,
    isLocked: z.boolean().optional(),
  })
  .strict();
export type UserCreateRequest = z.infer<typeof UserCreateRequestSchema>;

export const UserUpdateRequestSchema = z
  .object({
    username: nonEmptyString.optional(),
    isLocked: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UserUpdateRequest = z.infer<typeof UserUpdateRequestSchema>;

export const UsersResponseSchema = z
  .object({
    users: z.array(UserDtoSchema),
  })
  .strict();
export type UsersResponse = z.infer<typeof UsersResponseSchema>;

export const UserCreateResponseSchema = UserDtoSchema;
export type UserCreateResponse = UserDto;

export const UserGetResponseSchema = UserDtoSchema;
export type UserGetResponse = UserDto;

export const UserUpdateResponseSchema = UserDtoSchema;
export type UserUpdateResponse = UserDto;

export const MenuCategoryDtoSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    description: z.string(),
    isLocked: z.boolean(),
    weight: z.number().int(),
    printerId: positiveInt.optional(),
    orderDisplayId: positiveInt.optional(),
  })
  .strict();
export type MenuCategoryDto = z.infer<typeof MenuCategoryDtoSchema>;

export const MenuItemDtoSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    description: z.string(),
    weight: z.number().int(),
    price: z.number().nonnegative(),
    isLocked: z.boolean(),
    menuCategoryId: positiveInt,
  })
  .strict();
export type MenuItemDto = z.infer<typeof MenuItemDtoSchema>;

export const MenuCategoriesQuerySchema = z
  .object({
    locked: optionalBooleanQuerySchema
      .optional()
      .describe("Filter by lock state. Example: ?locked=true"),
    includeRouting: optionalBooleanQuerySchema
      .optional()
      .describe("Include printer/display routing fields. Example: ?includeRouting=true"),
  })
  .strict();
export type MenuCategoriesQuery = z.infer<typeof MenuCategoriesQuerySchema>;

export const MenuItemsQuerySchema = z
  .object({
    categoryId: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Filter by category id. Example: ?categoryId=2"),
    locked: optionalBooleanQuerySchema
      .optional()
      .describe("Filter by lock state. Example: ?locked=false"),
    sort: z
      .literal("weight,name")
      .optional()
      .describe("Supported sort key. Example: ?sort=weight,name"),
  })
  .strict();
export type MenuItemsQuery = z.infer<typeof MenuItemsQuerySchema>;

export const MenuCategoriesResponseSchema = z
  .object({
    categories: z.array(MenuCategoryDtoSchema),
  })
  .strict();
export type MenuCategoriesResponse = z.infer<typeof MenuCategoriesResponseSchema>;

export const MenuItemsResponseSchema = z
  .object({
    items: z.array(MenuItemDtoSchema),
  })
  .strict();
export type MenuItemsResponse = z.infer<typeof MenuItemsResponseSchema>;

export const MenuCategoryParamsSchema = z
  .object({
    categoryId: z.coerce.number().int().positive(),
  })
  .strict();
export type MenuCategoryParams = z.infer<typeof MenuCategoryParamsSchema>;

export const MenuItemParamsSchema = z
  .object({
    menuItemId: z.coerce.number().int().positive(),
  })
  .strict();
export type MenuItemParams = z.infer<typeof MenuItemParamsSchema>;

export const MenuCategoryCreateRequestSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().max(500).optional(),
    weight: z.number().int().optional(),
    isLocked: z.boolean().optional(),
    printerId: positiveInt.optional(),
    orderDisplayId: positiveInt.optional(),
  })
  .strict();
export type MenuCategoryCreateRequest = z.infer<typeof MenuCategoryCreateRequestSchema>;

export const MenuCategoryUpdateRequestSchema = z
  .object({
    name: nonEmptyString.optional(),
    description: z.string().max(500).optional(),
    weight: z.number().int().optional(),
    isLocked: z.boolean().optional(),
    printerId: positiveInt.optional(),
    orderDisplayId: positiveInt.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type MenuCategoryUpdateRequest = z.infer<typeof MenuCategoryUpdateRequestSchema>;

export const MenuItemCreateRequestSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().max(500).optional(),
    weight: z.number().int().optional(),
    price: z.number().nonnegative(),
    isLocked: z.boolean().optional(),
    menuCategoryId: positiveInt,
  })
  .strict();
export type MenuItemCreateRequest = z.infer<typeof MenuItemCreateRequestSchema>;

export const MenuItemUpdateRequestSchema = z
  .object({
    name: nonEmptyString.optional(),
    description: z.string().max(500).optional(),
    weight: z.number().int().optional(),
    price: z.number().nonnegative().optional(),
    isLocked: z.boolean().optional(),
    menuCategoryId: positiveInt.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type MenuItemUpdateRequest = z.infer<typeof MenuItemUpdateRequestSchema>;

export const MenuCategoryCreateResponseSchema = MenuCategoryDtoSchema;
export type MenuCategoryCreateResponse = MenuCategoryDto;

export const MenuCategoryUpdateResponseSchema = MenuCategoryDtoSchema;
export type MenuCategoryUpdateResponse = MenuCategoryDto;

export const MenuItemCreateResponseSchema = MenuItemDtoSchema;
export type MenuItemCreateResponse = MenuItemDto;

export const MenuItemUpdateResponseSchema = MenuItemDtoSchema;
export type MenuItemUpdateResponse = MenuItemDto;

export const StockItemDtoSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    quantity: z.number().int().nonnegative(),
  })
  .strict();
export type StockItemDto = z.infer<typeof StockItemDtoSchema>;

export const StockItemParamsSchema = z
  .object({
    stockItemId: z.coerce.number().int().positive(),
  })
  .strict();
export type StockItemParams = z.infer<typeof StockItemParamsSchema>;

export const StockItemsResponseSchema = z
  .object({
    items: z.array(StockItemDtoSchema),
  })
  .strict();
export type StockItemsResponse = z.infer<typeof StockItemsResponseSchema>;

export const StockItemCreateRequestSchema = z
  .object({
    name: nonEmptyString,
    quantity: z.number().int().nonnegative(),
  })
  .strict();
export type StockItemCreateRequest = z.infer<typeof StockItemCreateRequestSchema>;

export const StockItemUpdateRequestSchema = z
  .object({
    quantity: z.number().int().nonnegative().optional(),
    delta: z.number().int().optional(),
  })
  .strict()
  .refine((value) => value.quantity !== undefined || value.delta !== undefined, {
    message: "Provide quantity or delta",
  })
  .refine((value) => !(value.quantity !== undefined && value.delta !== undefined), {
    message: "Provide either quantity or delta, not both",
  });
export type StockItemUpdateRequest = z.infer<typeof StockItemUpdateRequestSchema>;

export const StockItemCreateResponseSchema = StockItemDtoSchema;
export type StockItemCreateResponse = StockItemDto;

export const StockItemUpdateResponseSchema = StockItemDtoSchema;
export type StockItemUpdateResponse = StockItemDto;

export const MenuItemStockRequirementDtoSchema = z
  .object({
    stockItemId: positiveInt,
    quantityRequired: z.number().int().positive(),
  })
  .strict();
export type MenuItemStockRequirementDto = z.infer<typeof MenuItemStockRequirementDtoSchema>;

export const MenuItemStockRequirementsReplaceRequestSchema = z
  .object({
    requirements: z.array(MenuItemStockRequirementDtoSchema),
  })
  .strict();
export type MenuItemStockRequirementsReplaceRequest = z.infer<
  typeof MenuItemStockRequirementsReplaceRequestSchema
>;

export const MenuItemStockRequirementsReplaceResponseSchema = z
  .object({
    menuItemId: positiveInt,
    requirements: z.array(MenuItemStockRequirementDtoSchema),
  })
  .strict();
export type MenuItemStockRequirementsReplaceResponse = z.infer<
  typeof MenuItemStockRequirementsReplaceResponseSchema
>;

export const PrinterDtoSchema = z
  .object({
    id: positiveInt,
    name: nonEmptyString,
    ipAddress: nonEmptyString,
    connectionDetails: z.string(),
  })
  .strict();
export type PrinterDto = z.infer<typeof PrinterDtoSchema>;

export const PrintersResponseSchema = z
  .object({
    printers: z.array(PrinterDtoSchema),
  })
  .strict();
export type PrintersResponse = z.infer<typeof PrintersResponseSchema>;

export const PrinterCreateRequestSchema = z
  .object({
    name: nonEmptyString,
    ipAddress: nonEmptyString,
    connectionDetails: z.string().trim().max(500).optional(),
  })
  .strict();
export type PrinterCreateRequest = z.infer<typeof PrinterCreateRequestSchema>;

export const PrinterCreateResponseSchema = PrinterDtoSchema;
export type PrinterCreateResponse = PrinterDto;

export const PrinterUpdateRequestSchema = z
  .object({
    name: nonEmptyString.optional(),
    ipAddress: nonEmptyString.optional(),
    connectionDetails: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type PrinterUpdateRequest = z.infer<typeof PrinterUpdateRequestSchema>;

export const PrinterGetResponseSchema = PrinterDtoSchema;
export type PrinterGetResponse = PrinterDto;

export const PrinterUpdateResponseSchema = PrinterDtoSchema;
export type PrinterUpdateResponse = PrinterDto;

export const PrinterParamsSchema = z
  .object({
    printerId: z.coerce.number().int().positive(),
  })
  .strict();
export type PrinterParams = z.infer<typeof PrinterParamsSchema>;

export const PrinterTestPrintResponseSchema = z
  .object({
    ok: z.literal(true),
    message: nonEmptyString,
  })
  .strict();
export type PrinterTestPrintResponse = z.infer<typeof PrinterTestPrintResponseSchema>;

export const ConfigValuesSchema = z.record(nonEmptyString, z.string());
export type ConfigValues = z.infer<typeof ConfigValuesSchema>;

export const ConfigGetResponseSchema = z
  .object({
    values: ConfigValuesSchema,
  })
  .strict();
export type ConfigGetResponse = z.infer<typeof ConfigGetResponseSchema>;

export const ConfigPatchRequestSchema = z
  .object({
    values: ConfigValuesSchema,
  })
  .strict()
  .refine((value) => Object.keys(value.values).length > 0, {
    message: "At least one config key must be provided",
    path: ["values"],
  });
export type ConfigPatchRequest = z.infer<typeof ConfigPatchRequestSchema>;

export const ConfigPatchResponseSchema = ConfigGetResponseSchema;
export type ConfigPatchResponse = ConfigGetResponse;

export const OrderSubmitItemRequestSchema = z
  .object({
    menuItemId: positiveInt,
    quantity: z.number().int().positive(),
    specialRequests: z.string().trim().max(500).optional(),
  })
  .strict();
export type OrderSubmitItemRequest = z.infer<
  typeof OrderSubmitItemRequestSchema
>;

export const OrderItemDtoSchema = z
  .object({
    id: positiveInt,
    menuItemId: positiveInt,
    quantity: z.number().int().positive(),
    specialRequests: z.string().trim().max(500).optional(),
  })
  .strict();
export type OrderItemDto = z.infer<typeof OrderItemDtoSchema>;

export const OrderDtoSchema = z
  .object({
    id: positiveInt,
    timestamp: z.string().datetime(),
    tableId: positiveInt,
    userId: positiveInt,
    items: z.array(OrderItemDtoSchema),
  })
  .strict();
export type OrderDto = z.infer<typeof OrderDtoSchema>;

export const WaiterSessionStartRequestSchema = z
  .object({
    username: nonEmptyString,
    eventPasscode: nonEmptyString,
  })
  .strict();
export type WaiterSessionStartRequest = z.infer<
  typeof WaiterSessionStartRequestSchema
>;

export const SessionRoleSchema = z.enum(["master", "admin", "waiter"]);
export type SessionRole = z.infer<typeof SessionRoleSchema>;

export const WaiterSessionStartResponseSchema = z
  .object({
    accessToken: nonEmptyString,
    expiresInSeconds: z.number().int().positive(),
    role: z.literal("waiter"),
    eventId: positiveInt,
    refreshToken: z.string().trim().min(1).optional(),
    user: UserDtoSchema.optional(),
  })
  .strict();
export type WaiterSessionStartResponse = z.infer<
  typeof WaiterSessionStartResponseSchema
>;

export const AdminSessionStartRequestSchema = z
  .object({
    eventId: positiveInt,
    username: nonEmptyString,
    password: nonEmptyString,
  })
  .strict();
export type AdminSessionStartRequest = z.infer<
  typeof AdminSessionStartRequestSchema
>;

export const AdminSessionStartResponseSchema = z
  .object({
    accessToken: nonEmptyString,
    expiresInSeconds: z.number().int().positive(),
    role: z.literal("admin"),
    eventId: positiveInt,
  })
  .strict();
export type AdminSessionStartResponse = z.infer<
  typeof AdminSessionStartResponseSchema
>;

export const SessionPrincipalSchema = z
  .object({
    role: SessionRoleSchema,
    eventId: positiveInt.optional(),
    user: UserDtoSchema.optional(),
  })
  .strict();
export type SessionPrincipal = z.infer<typeof SessionPrincipalSchema>;

export const MasterSessionStartRequestSchema = z
  .object({
    username: nonEmptyString,
    password: nonEmptyString,
  })
  .strict();
export type MasterSessionStartRequest = z.infer<typeof MasterSessionStartRequestSchema>;

export const MasterSessionStartResponseSchema = z
  .object({
    accessToken: nonEmptyString,
    expiresInSeconds: z.number().int().positive(),
    role: z.literal("master"),
  })
  .strict();
export type MasterSessionStartResponse = z.infer<typeof MasterSessionStartResponseSchema>;

export const TableQrResolveRequestSchema = z
  .object({
    qrValue: nonEmptyString,
  })
  .strict();
export type TableQrResolveRequest = z.infer<
  typeof TableQrResolveRequestSchema
>;

export const TableQrResolveResponseSchema = TableDtoSchema;
export type TableQrResolveResponse = TableDto;

export const EventDtoSchema = z
  .object({
    id: positiveInt,
    eventName: nonEmptyString,
    adminUsername: nonEmptyString,
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    closedAt: z.string().datetime().optional(),
  })
  .strict();
export type EventDto = z.infer<typeof EventDtoSchema>;

export const AdminEventCreateRequestSchema = z
  .object({
    eventName: nonEmptyString,
    eventPasscode: nonEmptyString,
    adminUsername: nonEmptyString,
    adminPassword: nonEmptyString,
  })
  .strict();
export type AdminEventCreateRequest = z.infer<typeof AdminEventCreateRequestSchema>;

export const ActiveEventResponseSchema = EventDtoSchema;
export type ActiveEventResponse = EventDto;

export const AdminEventCreateResponseSchema = EventDtoSchema;
export type AdminEventCreateResponse = EventDto;

export const AdminEventActivateResponseSchema = EventDtoSchema;
export type AdminEventActivateResponse = EventDto;

export const AdminEventDeactivateResponseSchema = EventDtoSchema;
export type AdminEventDeactivateResponse = EventDto;

export const EventListResponseSchema = z.array(EventDtoSchema);
export type EventListResponse = EventDto[];

export const EventPasscodeResponseSchema = z
  .object({ passcode: z.string() })
  .strict();
export type EventPasscodeResponse = z.infer<typeof EventPasscodeResponseSchema>;

export const RotatePasscodeRequestSchema = z
  .object({ newPasscode: nonEmptyString })
  .strict();
export type RotatePasscodeRequest = z.infer<typeof RotatePasscodeRequestSchema>;

export const RotatePasscodeResponseSchema = EventPasscodeResponseSchema;
export type RotatePasscodeResponse = EventPasscodeResponse;

export const HostInfoResponseSchema = z
  .object({
    localIp: z.string(),
  })
  .strict();
export type HostInfoResponse = z.infer<typeof HostInfoResponseSchema>;

export const AuthLoginRequestSchema = WaiterSessionStartRequestSchema;
export type AuthLoginRequest = WaiterSessionStartRequest;

export const AuthLoginResponseSchema = WaiterSessionStartResponseSchema;
export type AuthLoginResponse = WaiterSessionStartResponse;

export const AuthMeResponseSchema = SessionPrincipalSchema;
export type AuthMeResponse = SessionPrincipal;

export const OrderSubmitRequestSchema = z
  .object({
    tableId: positiveInt,
    items: z.array(OrderSubmitItemRequestSchema).min(1),
  })
  .strict();
export type OrderSubmitRequest = z.infer<typeof OrderSubmitRequestSchema>;

export const OrderSubmitResponseSchema = OrderDtoSchema;
export type OrderSubmitResponse = OrderDto;

export const OrdersQuerySchema = z
  .object({
    tableId: z.coerce.number().int().positive().optional(),
    userId: z.coerce.number().int().positive().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (value) => {
      if (!value.from || !value.to) {
        return true;
      }
      return value.from <= value.to;
    },
    {
      message: "from must be before or equal to to",
      path: ["from"],
    }
  );
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;

export const OrderParamsSchema = z
  .object({
    orderId: z.coerce.number().int().positive(),
  })
  .strict();
export type OrderParams = z.infer<typeof OrderParamsSchema>;

export const OrdersResponseSchema = z
  .object({
    orders: z.array(OrderDtoSchema),
  })
  .strict();
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;

export const OrderGetResponseSchema = OrderDtoSchema;
export type OrderGetResponse = OrderDto;

export const ApiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: nonEmptyString,
        message: nonEmptyString,
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

export const SharedModelSchemas = {
  configurations: ConfigurationsSchema,
  menuCategories: MenuCategoriesSchema,
  menuItems: MenuItemsSchema,
  orderDisplays: OrderDisplaysSchema,
  orderItems: OrderItemsSchema,
  orders: OrdersSchema,
  printers: PrintersSchema,
  stockItemMenuItem: StockItemMenuItemSchema,
  stockItems: StockItemsSchema,
  tables: TablesSchema,
  users: UsersSchema,
} as const;

export type SharedModelTypes = {
  configurations: Configurations;
  menuCategories: MenuCategories;
  menuItems: MenuItems;
  orderDisplays: OrderDisplays;
  orderItems: OrderItems;
  orders: Orders;
  printers: Printers;
  stockItemMenuItem: StockItemMenuItem;
  stockItems: StockItems;
  tables: Tables;
  users: Users;
};

