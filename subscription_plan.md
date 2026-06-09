# Plan: Plans & Subscriptions Module

## Context

The existing `src/billing` module has a complete Stripe integration with `BillingPlan`, `BillingPrice`, `BillingSubscription`, `BillingPayment`, and `BillingInvoice` entities. However, there are no history endpoints, no subscription timeline tracking, and the plan entity lacks display metadata (sort order, icon, highlight). This plan creates a new `src/plans-subscriptions/` module that imports `BillingModule` and adds:

1. Full CRUD for plans and prices with extended display fields
2. A subscription status-change timeline (`PlanSubscriptionHistory` entity)
3. User-facing subscription and payment history endpoints (paginated)

---

## Architecture Principles

This is a **portfolio project** targeting free/low-cost serverless hosting. Keep everything simple:

- **No Redis**, background workers, distributed locks, complex caching layers, or advanced domain-event infrastructure.
- **No message queues** (Kafka, RabbitMQ, SQS, etc.), no outbox pattern, no CQRS, no event sourcing, no microservices, no sagas, no state machines.
- **Yes to EventEmitter** — the current NestJS `EventEmitter2`-based integration between `BillingWebhookService` and `SubscriptionHistoryService` is sufficient.
- **Yes to simple pagination** — offset/limit queries on existing database tables.
- All services must remain **stateless** so they deploy cleanly on serverless runtimes (e.g., AWS Lambda via NestJS adapter).
- After this plan, the architecture is **finalized**. No further enterprise patterns will be introduced.

---

## Step 1: Extend `BillingPlan` Entity (Migration + Entity Update)

**Why:** Plans need display metadata for the pricing page.

### 1a. Create migration `AddPlanDisplayFields`

**File:** `db/migrations/1780200000000-AddPlanDisplayFields.ts`

Add columns to `billing_plans`:
- `display_order` int, default 0 — sort position for pricing page
- `icon` varchar(255), nullable — icon URL
- `highlight` boolean, default false — marks the "recommended" plan

### 1b. Update entity

**File:** `src/billing/entities/billing-plan.entity.ts`

Add the three new columns to match the migration.

---

## Step 2: Create `PlanSubscriptionHistory` Entity

**Why:** `BillingSubscription` only stores current state. We need a timeline of every status transition.

**File:** `src/plans-subscriptions/entities/plan-subscription-history.entity.ts`

```
Table: plan_subscription_history

| Column              | Type         | Notes                                      |
|---------------------|--------------|---------------------------------------------|
| id                  | UUID PK     | Auto-generated                              |
| userId              | int          | NOT NULL, FK -> users.id (CASCADE)          |
| subscriptionId      | UUID         | FK -> billing_subscriptions.id (SET NULL)   |
| previousStatus      | enum         | BillingSubscriptionStatus, nullable (null   |
|                     |              | = initial creation)                         |
| newStatus           | enum         | BillingSubscriptionStatus, NOT NULL         |
| planId              | UUID, nullable | FK -> billing_plans.id (SET NULL)          |
| priceId             | UUID, nullable | FK -> billing_prices.id (SET NULL)         |
| stripeEventId       | varchar(255), nullable | UNIQUE — dedup webhook deliveries  |
| reason              | varchar(255), nullable | e.g. "webhook: sub.updated",          |
|                     |              | "checkout.completed", "user.cancel"        |
| metadata            | jsonb        | Additional context (period dates, etc.)     |
| occurredAt          | timestamp    | When the status change happened             |
| createdAt           | timestamp    | Record creation time                         |
```

> **Note on `planId` / `priceId`:** These fields are intentionally duplicated here as historical references. They preserve the exact plan and price associated with the status change at the time the event occurred, even if the subscription's linked plan or price is later updated or removed.

### 2a. Webhook Idempotency

`stripeEventId` stores the Stripe event ID (e.g. `evt_3O123456789`). The **UNIQUE constraint** ensures duplicate webhook deliveries cannot insert duplicate history records. In `SubscriptionHistoryService`, use `INSERT ... ON CONFLICT DO NOTHING` or catch the unique-violation error gracefully.

### 2b. Create migration

**File:** `db/migrations/1780200000001-CreatePlanSubscriptionHistory.ts`

Creates the `plan_subscription_history` table with all columns, UNIQUE constraint, and indexes.

---

## Step 3: Database Indexes

Ensure the following indexes exist for performant history and billing queries:

### plan_subscription_history

```sql
CREATE INDEX idx_plan_sub_hist_user_occurred
  ON plan_subscription_history (user_id, occurred_at DESC);

CREATE INDEX idx_plan_sub_hist_subscription
  ON plan_subscription_history (subscription_id);

CREATE UNIQUE INDEX idx_plan_sub_hist_stripe_event
  ON plan_subscription_history (stripe_event_id) WHERE stripe_event_id IS NOT NULL;
```

### billing_subscriptions

```sql
CREATE INDEX idx_billing_subs_user_status
  ON billing_subscriptions (user_id, status);
```

### billing_payments

```sql
CREATE INDEX idx_billing_payments_user_created
  ON billing_payments (user_id, created_at DESC);
```

### Migration

**File:** `db/migrations/1780200000002-AddBillingIndexes.ts`

Creates the three indexes above (in addition to the ones already created in Step 2b for `plan_subscription_history`).

---

## Step 4: Create `src/plans-subscriptions/` Module Structure

```
src/plans-subscriptions/
├── plans-subscriptions.module.ts
├── controllers/
│   ├── admin-plans.controller.ts        # Admin CRUD for plans + prices
│   ├── public-plans.controller.ts       # Public plan listing
│   ├── user-subscriptions.controller.ts # User-facing subscription history
│   └── user-payments.controller.ts      # User-facing payment history
├── services/
│   ├── plan-management.service.ts       # Plan CRUD (wraps BillingCatalogService)
│   ├── price-management.service.ts      # Price CRUD (wraps BillingCatalogService)
│   ├── plan-display.service.ts          # Public plan listing with display fields
│   ├── subscription-history.service.ts  # Status-change timeline tracking
│   └── user-billing-history.service.ts  # User-facing subscription + payment queries
├── dto/
│   ├── create-plan.dto.ts
│   ├── update-plan.dto.ts
│   ├── create-price.dto.ts
│   ├── plan-response.dto.ts
│   ├── price-response.dto.ts
│   ├── pagination-query.dto.ts          # Shared pagination params
│   ├── paginated-response.dto.ts        # Shared paginated response wrapper
│   ├── subscription-history-response.dto.ts
│   ├── user-subscription-history.dto.ts
│   └── user-payment-history.dto.ts
├── entities/
│   └── plan-subscription-history.entity.ts
└── guards/                              # (reuses FeatureAccessGuard from billing)
```

> **Why keep 5 services?** The current separation improves readability and showcases architecture skills without introducing meaningful complexity. Each service has a clear, single responsibility. Do not merge them.

### 4a. Module wiring

**File:** `src/plans-subscriptions/plans-subscriptions.module.ts`

```
@Module({
  imports: [
    TypeOrmModule.forFeature([PlanSubscriptionHistory]),
    BillingModule,          // imports all billing entities + services
    UserModule,
  ],
  controllers: [...],
  providers: [...],
  exports: [PlanSubscriptionHistoryService, SubscriptionHistoryService],
})
```

---

## Step 5: Plan Management Service

**File:** `src/plans-subscriptions/services/plan-management.service.ts`

Wraps `BillingCatalogService` with extended field support.

### Methods:
- `createPlan(dto: CreatePlanDto)` — creates plan via `BillingCatalogService.createPlan()` + sets display fields
- `updatePlan(id, dto: UpdatePlanDto)` — updates plan + display fields
- `archivePlan(id)` — delegates to `BillingCatalogService.archivePlan()`
- `getPlan(id)` — returns plan with prices and display fields
- `listPlans(query)` — admin listing with status filter, ordered by `displayOrder`

### DTOs with Validation:

**`CreatePlanDto`:**
- `code` — `@IsString()`, `@Length(1, 50)`, slug format
- `name` — `@IsString()`, `@Length(1, 255)`
- `description` — `@IsString()`, `@MaxLength(2000)`, optional
- `features` — `@IsArray()`, `@IsString({ each: true })`, optional
- `displayOrder` — `@IsInt()`, `@Min(0)`, optional, default 0
- `icon` — `@IsOptional()`, `@IsString()`, `@MaxLength(255)`, optional
- `highlight` — `@IsBoolean()`, optional, default false
- `metadata` — `@IsObject()`, optional

**`UpdatePlanDto`:**
- All fields optional (partial update), same validation rules applied individually

---

## Step 6: Price Management Service

**File:** `src/plans-subscriptions/services/price-management.service.ts`

### Methods:
- `addPrice(planId, dto: CreatePriceDto)` — adds price to a plan via `BillingCatalogService.addPrice()`
- `getPrice(id)` — returns price with plan relation
- `listPricesForPlan(planId)` — all prices for a given plan
- `deactivatePrice(id)` — sets `active = false`

**Note:** Prices reference Stripe price IDs. The service validates the price exists in Stripe before creating the local record.

### DTO with Validation:

**`CreatePriceDto`:**
- `stripePriceId` — `@IsString()`, `@Length(1, 255)`
- `currency` — `@IsString()`, `@Length(3, 3)`
- `unitAmount` — `@IsInt()`, `@Min(1)` (positive minor units)
- `type` — `@IsEnum(PriceType)` (one_time | recurring)
- `interval` — `@IsEnum(PriceInterval)` (day | week | month | year), conditional via `@ValidateIf` — required if type=recurring
- `trialPeriodDays` — `@IsInt()`, `@Min(0)`, `@Max(365)`, optional
- `active` — `@IsBoolean()`, optional, default true

---

## Step 7: Subscription History Service

**File:** `src/plans-subscriptions/services/subscription-history.service.ts`

### Methods:
- `recordStatusChange(params)` — creates a history entry. On duplicate `stripeEventId`, silently skips (ON CONFLICT DO NOTHING / catch unique violation).
- `getHistoryForSubscription(subscriptionId)` — timeline for one subscription
- `getHistoryForUser(userId, pagination)` — all subscription changes for a user, ordered by `occurredAt DESC`

### Integration with BillingModule (EventEmitter — keep it simple):

The `BillingWebhookService` handles `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. It emits internal events after processing:

1. `billing.subscription.created` — record initial status (from `incomplete` → `active` or `trialing`)
2. `billing.subscription.updated` — record status change
3. `billing.subscription.deleted` — record cancellation

`SubscriptionHistoryService` listens for these events and records history entries. This is a **NestJS EventEmitter2** integration — no message queues, no outbox pattern, no event sourcing. The current approach is sufficient for a portfolio project.

---

## Step 8: User Billing History Service

**File:** `src/plans-subscriptions/services/user-billing-history.service.ts`

### Methods:

**Subscription history:**
- `getUserSubscriptionHistory(userId, pagination: PaginationQuery)` — returns paginated subscription history:
  - Plan name, price details
  - Status timeline (from `PlanSubscriptionHistory`)
  - Current period, trial info
  - Cancellation details

**Payment history:**
- `getUserPaymentHistory(userId, pagination: PaginationQuery)` — returns paginated payment history:
  - Amount, currency, status
  - Linked subscription (if any)
  - Invoice details (if any)
  - Refund info (amount refunded, status)
  - Transaction type (charge/refund)

### Pagination Contract:

Both methods accept `PaginationQueryDto`:
```
?page=1&limit=20
```
- `page` — `@IsInt()`, `@Min(1)`, default 1
- `limit` — `@IsInt()`, `@Min(1)`, `@Max(100)`, default 20

Return `PaginatedResponseDto<T>`:
```json
{
  "items": [],
  "page": 1,
  "limit": 20,
  "total": 100,
  "totalPages": 5
}
```

### Queries:

Both methods query the existing billing entities (`BillingSubscription`, `BillingPayment`, `BillingTransaction`, `BillingInvoice`) via the imported `BillingModule` repositories, using the database indexes defined in Step 3.

---

## Step 9: Controllers

### 9a. Admin Plans Controller (JWT + Admin role)

**File:** `src/plans-subscriptions/controllers/admin-plans.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/admin/plans` | Create plan with display fields |
| `GET` | `/api/admin/plans` | List all plans (with status filter) |
| `GET` | `/api/admin/plans/:id` | Get plan detail with prices |
| `PATCH` | `/api/admin/plans/:id` | Update plan |
| `POST` | `/api/admin/plans/:id/archive` | Archive plan |
| `POST` | `/api/admin/plans/:id/prices` | Add price to plan |
| `GET` | `/api/admin/plans/:id/prices` | List prices for plan |
| `PATCH` | `/api/admin/prices/:id` | Update price (deactivate) |

### 9b. Public Plans Controller (no auth)

**File:** `src/plans-subscriptions/controllers/public-plans.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/plans` | List active plans with prices, ordered by displayOrder |

### 9c. User Subscription History Controller (JWT)

**File:** `src/plans-subscriptions/controllers/user-subscriptions.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/subscriptions/history` | User's full subscription history (paginated with `?page=&limit=`) |
| `GET` | `/api/subscriptions/history/:subscriptionId` | Detailed timeline for one subscription |
| `GET` | `/api/subscriptions/current` | Current active subscription (single, if any) |

### 9d. User Payments Controller (JWT)

**File:** `src/plans-subscriptions/controllers/user-payments.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/payments/history` | User's full payment history (paginated with `?page=&limit=`) |
| `GET` | `/api/payments/:id` | Payment detail with transaction timeline |

---

## Step 10: Subscription Rules — One Active Subscription Per User

```
A user may only have one active subscription at a time.

If an active subscription already exists, the application rejects
creation of another active subscription unless the action is handled
through a dedicated plan-change or upgrade flow.
```

- "Active" means `status IN ('trialing', 'active', 'past_due')` on `BillingSubscription`.
- `GET /api/subscriptions/current` returns the single active subscription (if any) — not an array.
- Plan changes / upgrades are handled through a separate dedicated route that cancels the existing subscription first.
- This avoids unnecessary auto-cancellation and aligns with Stripe subscription management.

---

## Step 11: Wire into AppModule

**File:** `src/app.module.ts`

Add `PlansSubscriptionsModule` to imports.

---

## Step 12: Emit Events from Billing Webhook Service

**File:** `src/billing/services/billing-webhook.service.ts`

Add event emissions after subscription status changes:

```typescript
// In handleSubscriptionCreated:
this.eventEmitter.emit('billing.subscription.created', { subscription, stripeEvent });

// In handleSubscriptionUpdated:
this.eventEmitter.emit('billing.subscription.updated', { subscription, previousStatus, stripeEvent });

// In handleSubscriptionDeleted:
this.eventEmitter.emit('billing.subscription.deleted', { subscription, stripeEvent });
```

This requires injecting `EventEmitter2` into `BillingWebhookService`.

---

## Step 13: Tests

- Unit tests for `PlanManagementService`, `PriceManagementService`, `SubscriptionHistoryService`, `UserBillingHistoryService`
- E2E tests for admin plan CRUD endpoints
- E2E tests for user subscription/payment history endpoints (with pagination)
- E2E tests for pagination (page, limit, total, totalPages)
- Integration test for webhook → history recording flow (including duplicate webhook idempotency)

---

## Entity Relationship Summary

```
User (existing)
  │
  ├─ 1:1 ─> BillingCustomer (existing)
  │            │
  │            ├─ 1:N ─> BillingSubscription (existing)
  │            │            │   (one active at a time per user)
  │            │            ├─ M:1 ─> BillingPlan (extended with display fields)
  │            │            ├─ M:1 ─> BillingPrice (existing)
  │            │            │
  │            │            └─ 1:N ─> PlanSubscriptionHistory (NEW)
  │            │                         UNIQUE(stripeEventId)
  │            │
  │            ├─ 1:N ─> BillingPayment (existing)
  │            │            └─ M:1 ─> BillingPrice
  │            │
  │            └─ 1:N ─> BillingInvoice (existing)
  │
  └─ 1:N ─> PlanSubscriptionHistory (via userId, NEW)
```

---

## Migration Summary

| # | File | Purpose |
|---|------|---------|
| 1 | `1780200000000-AddPlanDisplayFields.ts` | Add `display_order`, `icon`, `highlight` to `billing_plans` |
| 2 | `1780200000001-CreatePlanSubscriptionHistory.ts` | Create `plan_subscription_history` table with UNIQUE `stripe_event_id` and indexes |
| 3 | `1780200000002-AddBillingIndexes.ts` | Add indexes on `billing_subscriptions(user_id, status)` and `billing_payments(user_id, created_at)` |

---

## Key Files to Create

| File | Description |
|------|-------------|
| `db/migrations/1780200000000-AddPlanDisplayFields.ts` | Migration: extend billing_plans |
| `db/migrations/1780200000001-CreatePlanSubscriptionHistory.ts` | Migration: new history table + UNIQUE stripeEventId + indexes |
| `db/migrations/1780200000002-AddBillingIndexes.ts` | Migration: add performance indexes |
| `src/billing/entities/billing-plan.entity.ts` | **Modify:** add 3 columns |
| `src/billing/services/billing-webhook.service.ts` | **Modify:** emit events on sub changes via EventEmitter2 |
| `src/plans-subscriptions/plans-subscriptions.module.ts` | New module definition |
| `src/plans-subscriptions/entities/plan-subscription-history.entity.ts` | New entity with UNIQUE on stripeEventId |
| `src/plans-subscriptions/services/plan-management.service.ts` | Plan CRUD service |
| `src/plans-subscriptions/services/price-management.service.ts` | Price management service |
| `src/plans-subscriptions/services/plan-display.service.ts` | Public plan listing service |
| `src/plans-subscriptions/services/subscription-history.service.ts` | Timeline tracking with dedup |
| `src/plans-subscriptions/services/user-billing-history.service.ts` | User history queries with pagination |
| `src/plans-subscriptions/controllers/admin-plans.controller.ts` | Admin plan endpoints |
| `src/plans-subscriptions/controllers/public-plans.controller.ts` | Public plan listing |
| `src/plans-subscriptions/controllers/user-subscriptions.controller.ts` | User subscription history (paginated) |
| `src/plans-subscriptions/controllers/user-payments.controller.ts` | User payment history (paginated) |
| `src/plans-subscriptions/dto/*.dto.ts` | All DTOs with class-validator decorators (10 files) |
| `src/app.module.ts` | **Modify:** add module import |

---

## Final Validation Pass

Confirm every requirement before implementation:

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Webhook idempotency via `UNIQUE(stripe_event_id)` | ✅ Step 2 |
| 2 | Pagination (`?page=&limit=`) on history endpoints | ✅ Step 8, 9 |
| 3 | All required database indexes present | ✅ Step 3 |
| 4 | DTO validation with class-validator decorators | ✅ Step 5, 6 |
| 5 | EventEmitter integration (not replaced) | ✅ Step 7 |
| 6 | No Redis, queues, outbox, CQRS, event sourcing | ✅ Architecture Principles |
| 7 | Serverless-compatible, stateless services | ✅ Architecture Principles |
| 8 | One active subscription per user rule | ✅ Step 10 |
| 9 | `planId` / `priceId` historical snapshot note | ✅ Step 2 |
| 10 | Architecture finalized — no further enterprise patterns | ✅ Architecture Principles |
