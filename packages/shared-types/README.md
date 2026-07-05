# @bstoema/shared-types

Shared Zod schemas and inferred TypeScript types for the BstöMa apps.

## Exports

### Prisma model schemas

- `ConfigurationsSchema` / `Configurations`
- `UsersSchema` / `Users`
- `PrintersSchema` / `Printers`
- `OrderDisplaysSchema` / `OrderDisplays`
- `TablesSchema` / `Tables`
- `MenuCategoriesSchema` / `MenuCategories`
- `MenuItemsSchema` / `MenuItems`
- `StockItemsSchema` / `StockItems`
- `StockItemMenuItemSchema` / `StockItemMenuItem`
- `OrdersSchema` / `Orders`
- `OrderItemsSchema` / `OrderItems`

### API contracts

- `WaiterSessionStartRequestSchema` / `WaiterSessionStartRequest`
- `WaiterSessionStartResponseSchema` / `WaiterSessionStartResponse`
- `TableQrResolveRequestSchema` / `TableQrResolveRequest`
- `TableQrResolveResponseSchema` / `TableQrResolveResponse`
- `OrderSubmitRequestSchema` / `OrderSubmitRequest`
- `OrderSubmitResponseSchema` / `OrderSubmitResponse`
- `ApiErrorEnvelopeSchema` / `ApiErrorEnvelope`

## Aggregates

- `SharedModelSchemas` / `SharedModelTypes`

## Build

```bash
pnpm --filter @bstoema/shared-types build
```

## Usage

```ts
import {
  OrderSubmitRequestSchema,
  type OrderSubmitRequest,
} from '@bstoema/shared-types';
```

