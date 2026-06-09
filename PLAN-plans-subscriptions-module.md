# Plan: Plans & Subscriptions Module

## Context

The existing `src/billing` module has a complete Stripe integration with `BillingPlan`, `BillingPrice`, `BillingSubscription`, `BillingPayment`, and `BillingInvoice` entities. However, there are no history endpoints, no subscription timeline tracking, and the plan entity lacks display metadata (sort order, icon, highlight). This plan creates a new `src/plans-subscriptions/` module that imports `BillingModule` and adds:

1. Full CRUD for plans and prices with extended display fields
2. A subscription status-change timeline (`PlanSubscriptionHistory` entity)
3. User-facing subscription and payment history endpoints

---

## Step 1: Extend `BillingPlan` Entity (Migration + Entity Update)

**Why:** Plans need display metadata for the pricing page.

### 1a. Create migration `AddPlanDisplayFields`

**File:** `db/migrations/1780200000000-AddPlanDisplayFields.ts`

Add columns to `billing_plans`:
- `display_order` int, default 0 — sort position for pricing page
- `icon` varchar(255), nullable — icon URL or emoji
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
| userId              | int          | Indexed, FK -> users.id (CASCADE)          |
| subscriptionId      | UUID         | Indexed, FK -> billing_subscriptions.id     |
|                     |              | (SET NULL — keep history if sub deleted)    |
| previousStatus      | enum         | BillingSubscriptionStatus, nullable (null   |
|                     |              | = initial creation)                         |
| newStatus           | enum         | BillingSubscriptionStatus                  |
| planId              | UUID, nullable | FK -> billing_plans.id (SET NULL)          |
| priceId             | UUID, nullable | FK -> billing_prices.id (SET NULL)         |
| stripeEventId       | varchar(255), nullable | For dedup on webhook processing  |
| reason              | varchar(255), nullable | e.g. "webhook: sub.updated",          |
|                     |              | "checkout.completed", "user.cancel"        |
| metadata            | jsonb        | Additional context (period dates, etc.)    |
| occurredAt          | timestamp    | When the status change happened            |
| createdAt           | timestamp    | Record creation time                        |
```

**Indexes:** `(userId, occurredAt)`, `(subscriptionId)`

### 2a. Create migration

**File:** `db/migrations/1780200000001-CreatePlanSubscriptionHistory.ts`

Creates the `plan_subscription_history` table with all columns and indexes.

---

## Step 3: Create `src/plans-subscriptions/` Module Structure

```
src/plans-subscriptions/
├── plans-subscriptions.module.ts
├── controllers/
│   ├── admin-plans.controller.ts        # Admin CRUD for plans + prices
│   ├── admin-prices.controller.ts       # Admin CRUD for prices (nested under plans)
│   ├── user-subscriptions.controller.ts # User-facing subscription history
│   └── user-payments.controller.ts      # User-facing payment history
├── services/
│   ├── plan-management.service.ts       # Plan CRUD (wraps BillingCatalogService)
│   ├── price-management.service.ts      # Price CRUD (wraps BillingCatalogService)
│   ├── subscription-history.service.ts  # Status-change timeline tracking
│   ├── user-billing-history.service.ts  # User-facing subscription + payment queries
│   └── plan-display.service.ts          # Public plan listing with display fields
├── dto/
│   ├── create-plan.dto.ts
│   ├── update-plan.dto.ts
│   ├── create-price.dto.ts
│   ├── plan-response.dto.ts
│   ├── price-response.dto.ts
│   ├── subscription-history-response.dto.ts
│   ├── user-subscription-history.dto.ts
│   └── user-payment-history.dto.ts
├── entities/
│   └── plan-subscription-history.entity.ts
└── guards/                              # (reuses FeatureAccessGuard from billing)
```

### 3a. Module wiring

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

## Step 4: Plan Management Service

**File:** `src/plans-subscriptions/services/plan-management.service.ts`

Wraps `BillingCatalogService` with extended field support.

### Methods:
- `createPlan(dto: CreatePlanDto)` — creates plan via `BillingCatalogService.createPlan()` + sets display fields
- `updatePlan(id, dto: UpdatePlanDto)` — updates plan + display fields
- `archivePlan(id)` — delegates to `BillingCatalogService.archivePlan()`
- `getPlan(id)` — returns plan with prices and display fields
- `listPlans(query)` — admin listing with status filter, ordered by `displayOrder`

### DTOs:

**`CreatePlanDto`:**
- `code` (string, required, slug format)
- `name` (string, required)
- `description` (string, optional)
- `features` (string[], optional)
- `displayOrder` (int, optional, default 0)
- `icon` (string, optional)
- `highlight` (boolean, optional, default false)
- `metadata` (object, optional)

**`UpdatePlanDto`:**
- All fields optional (partial update)

---

## Step 5: Price Management Service

**File:** `src/plans-subscriptions/services/price-management.service.ts`

### Methods:
- `addPrice(planId, dto: CreatePriceDto)` — adds price to a plan via `BillingCatalogService.addPrice()`
- `getPrice(id)` — returns price with plan relation
- `listPricesForPlan(planId)` — all prices for a given plan
- `deactivatePrice(id)` — sets `active = false`

**Note:** Prices reference Stripe price IDs. The service validates the price exists in Stripe before creating the local record.

### DTOs:

**`CreatePriceDto`:**
- `stripePriceId` (string, required)
- `currency` (string, required, 3 chars)
- `unitAmount` (int, required, minor units)
- `type` (enum: one_time | recurring, required)
- `interval` (enum: day | week | month | year, conditional — required if type=recurring)
- `trialPeriodDays` (int, optional)
- `active` (boolean, optional, default true)

---

## Step 6: Subscription History Service

**File:** `src/plans-subscriptions/services/subscription-history.service.ts`

### Methods:
- `recordStatusChange(params)` — creates a history entry. Called by:
  - Webhook handler (when subscription status changes)
  - Checkout completion (initial subscription creation)
  - User cancellation
- `getHistoryForSubscription(subscriptionId)` — timeline for one subscription
- `getHistoryForUser(userId, pagination)` — all subscription changes for a user, ordered by `occurredAt DESC`

### Integration with BillingModule:

The key integration point is the **webhook flow**. The `BillingWebhookService` handles `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. We need to hook into these events to record history.

**Approach:** Use NestJS `EventEmitter` to decouple:
1. `BillingWebhookService` emits internal events (e.g., `billing.subscription.status_changed`) after processing Stripe webhooks
2. `SubscriptionHistoryService` listens for these events and records history entries

This avoids modifying the existing billing module's webhook handler directly.

**Events to listen for:**
- `billing.subscription.created` — record initial status (from `incomplete` → `active` or `trialing`)
- `billing.subscription.updated` — record status change
- `billing.subscription.deleted` — record cancellation

---

## Step 7: User Billing History Service

**File:** `src/plans-subscriptions/services/user-billing-history.service.ts`

### Methods:

**Subscription history:**
- `getUserSubscriptionHistory(userId, pagination)` — returns all subscriptions for a user with:
  - Plan name, price details
  - Status timeline (from `PlanSubscriptionHistory`)
  - Current period, trial info
  - Cancellation details

**Payment history:**
- `getUserPaymentHistory(userId, pagination)` — returns all payments for a user with:
  - Amount, currency, status
  - Linked subscription (if any)
  - Invoice details (if any)
  - Refund info (amount refunded, status)
  - Transaction type (charge/refund)

### Queries:

Both methods query the existing billing entities (`BillingSubscription`, `BillingPayment`, `BillingTransaction`, `BillingInvoice`) via the imported `BillingModule` repositories.

---

## Step 8: Controllers

### 8a. Admin Plans Controller (JWT + Admin role)

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

### 8b. Public Plans Controller (no auth)

**File:** `src/plans-subscriptions/controllers/public-plans.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/plans` | List active plans with prices, ordered by displayOrder |

### 8c. User Subscription History Controller (JWT)

**File:** `src/plans-subscriptions/controllers/user-subscriptions.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/subscriptions/history` | User's full subscription history with status timeline |
| `GET` | `/api/subscriptions/history/:subscriptionId` | Detailed timeline for one subscription |
| `GET` | `/api/subscriptions/current` | Current active subscription (if any) |

### 8d. User Payments Controller (JWT)

**File:** `src/plans-subscriptions/controllers/user-payments.controller.ts`

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/payments/history` | User's full payment history |
| `GET` | `/api/payments/:id` | Payment detail with transaction timeline |

---

## Step 9: Wire into AppModule

**File:** `src/app.module.ts`

Add `PlansSubscriptionsModule` to imports.

---

## Step 10: Emit Events from Billing Webhook Service

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

## Step 11: Tests

- Unit tests for `PlanManagementService`, `PriceManagementService`, `SubscriptionHistoryService`, `UserBillingHistoryService`
- E2E tests for admin plan CRUD endpoints
- E2E tests for user subscription/payment history endpoints
- Integration test for webhook → history recording flow

---

## Entity Relationship Summary

```
User (existing)
  │
  ├─ 1:1 ─> BillingCustomer (existing)
  │            │
  │            ├─ 1:N ─> BillingSubscription (existing)
  │            │            │
  │            │            ├─ M:1 ─> BillingPlan (extended with display fields)
  │            │            ├─ M:1 ─> BillingPrice (existing)
  │            │            │
  │            │            └─ 1:N ─> PlanSubscriptionHistory (NEW)
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
| 2 | `1780200000001-CreatePlanSubscriptionHistory.ts` | Create `plan_subscription_history` table |

---

## Key Files to Create

| File | Description |
|------|-------------|
| `db/migrations/1780200000000-AddPlanDisplayFields.ts` | Migration: extend billing_plans |
| `db/migrations/1780200000001-CreatePlanSubscriptionHistory.ts` | Migration: new history table |
| `src/billing/entities/billing-plan.entity.ts` | **Modify:** add 3 columns |
| `src/billing/services/billing-webhook.service.ts` | **Modify:** emit events on sub changes |
| `src/plans-subscriptions/plans-subscriptions.module.ts` | New module definition |
| `src/plans-subscriptions/entities/plan-subscription-history.entity.ts` | New entity |
| `src/plans-subscriptions/services/plan-management.service.ts` | Plan CRUD service |
| `src/plans-subscriptions/services/price-management.service.ts` | Price management service |
| `src/plans-subscriptions/services/subscription-history.service.ts` | Timeline tracking |
| `src/plans-subscriptions/services/user-billing-history.service.ts` | User history queries |
| `src/plans-subscriptions/services/plan-display.service.ts` | Public plan listing |
| `src/plans-subscriptions/controllers/admin-plans.controller.ts` | Admin plan endpoints |
| `src/plans-subscriptions/controllers/public-plans.controller.ts` | Public plan listing |
| `src/plans-subscriptions/controllers/user-subscriptions.controller.ts` | User subscription history |
| `src/plans-subscriptions/controllers/user-payments.controller.ts` | User payment history |
| `src/plans-subscriptions/dto/*.dto.ts` | All DTOs (8 files) |
| `src/app.module.ts` | **Modify:** add module import |
