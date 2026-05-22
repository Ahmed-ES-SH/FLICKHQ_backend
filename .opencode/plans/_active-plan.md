# Plan: Build Cart Module & Rebuild Payments Module with Stripe Best Practices

## Overview
This plan covers building a new **Cart Module** from scratch and **rebuilding the Payments Module** to follow Stripe best practices (API version 2026-04-22.dahlia), with a focus on robust webhook handling, Checkout Sessions pattern, and separation of concerns.

---

## Phase 1: Cart Module

### 1.1 Database Schema (`src/cart/schema/cart-item.schema.ts`)
- **Cart Entity**: `id`, `userId` (FK to users, unique), `createdAt`, `updatedAt`
- **CartItem Entity**: `id`, `cartId` (FK to carts), `productId` (FK to products), `quantity`, `createdAt`, `updatedAt`
- Indexes: `userId` unique on Cart, composite unique on `cartId + productId`
- Soft deletes not needed; cart is ephemeral

### 1.2 DTOs (`src/cart/dto/`)
- `AddToCartDto`: `productId` (UUID, validated), `quantity` (int, min 1, max 100)
- `UpdateCartItemDto`: `quantity` (int, min 1, max 100)
- `CartResponseDto`: Cart with items, product details (price, title, thumbnail, stock), subtotal per item, cart total

### 1.3 Repository (`src/cart/cart.repository.ts`)
- `findByUserId(userId)`: Load cart with items and product relations
- `findOrCreate(userId)`: Get or create cart for user
- `addItem(cartId, productId, quantity)`: Insert or update quantity
- `updateItemQuantity(cartId, productId, quantity)`: Update quantity
- `removeItem(cartId, productId)`: Delete cart item
- `clearCart(cartId)`: Delete all items
- `calculateTotal(cartId)`: Sum of (price * quantity) for all items

### 1.4 Service (`src/cart/cart.service.ts`)
- `addToCart(userId, dto)`: Find/create cart, validate product exists & in stock, add/update item
- `updateCartItem(userId, productId, dto)`: Update quantity, validate stock
- `removeFromCart(userId, productId)`: Remove item
- `clearCart(userId)`: Clear all items
- `getCart(userId)`: Return cart with items, product details, calculated totals
- Stock validation: reject if quantity > product.stock
- Price fetched from Product entity at cart time; final price validated at checkout

### 1.5 Controllers (`src/cart/`)
- **CartController** (`cart.controller.ts`): Authenticated routes
  - `GET /cart` - Get user's cart
  - `POST /cart/items` - Add item to cart
  - `PATCH /cart/items/:productId` - Update item quantity
  - `DELETE /cart/items/:productId` - Remove item
  - `DELETE /cart` - Clear cart
- All routes use `@GetUser('id')` decorator, `@UseGuards(AuthGuard)`
- Swagger annotations on all endpoints

### 1.6 Module (`src/cart/cart.module.ts`)
- Imports: `TypeOrmModule.forFeature([Cart, CartItem, Product])`
- Providers: `CartService`, `CartRepository`
- Controllers: `CartController`
- Exports: `CartService` (needed by Payments module for checkout)

---

## Phase 2: Payments Module Rebuild

### 2.1 Architecture Decision: Checkout Sessions over raw PaymentIntents
Per Stripe best practices:
- **Checkout Sessions** is preferred for on-session payments (handles taxes, dynamic payment methods, adaptive UX)
- **PaymentIntents** only for off-session payments or when modeling checkout state independently
- **Omit `payment_method_types`** entirely to enable dynamic payment methods
- Use **restricted API keys (RAKs)** with minimum permissions

### 2.2 Updated Schema (`src/modules/payments/schema/payment.schema.ts`)
Add fields:
- `stripeCheckoutSessionId` (nullable, for Checkout Sessions)
- `stripeCustomerId` (for tracking)
- `cartSnapshot` (JSONB - store cart items at checkout time for audit)
- `lineItems` (JSONB - Stripe line items snapshot)
- Keep existing: `id`, `userId`, `stripePaymentIntent`, `stripeChargeId`, `amount`, `currency`, `status`, `description`, `metadata`, `idempotencyKey`, timestamps

### 2.3 Updated Stripe Types (`src/modules/payments/types/stripe.types.ts`)
Add:
- `StripeCheckoutSession` interface
- `StripeSubscription` interface (if recurring billing needed)
- Type guards for new types
- Update `StripeWebhookEvent` to handle all event types

### 2.4 Updated DTOs (`src/modules/payments/dto/`)
- `CreateCheckoutSessionDto`: 
  - `cartId` (optional - if using cart)
  - `productType` (optional - for direct premium subscription)
  - `successUrl`, `cancelUrl` (validated URLs)
  - `mode`: `'payment' | 'subscription'`
- Keep `CreatePaymentIntentDto` for off-session or direct payment flows

### 2.5 Service (`src/modules/payments/payments.service.ts`)

#### New Methods:
- `createCheckoutSession(userId, dto)`: 
  - Load cart items or product type
  - Build line items with server-side prices (NEVER trust client)
  - Create Stripe Checkout Session with:
    - `mode`: payment or subscription
    - `customer` (existing or create)
    - `line_items` with price data
    - `success_url`, `cancel_url`
    - `metadata` with userId
    - NO `payment_method_types` (dynamic)
  - Persist payment record with session ID
  - Return `{ url: session.url, sessionId }`

- `handleCheckoutSessionCompleted(session)`: 
  - Find payment by session ID
  - Update status to SUCCEEDED
  - Clear user's cart
  - Update user premium status (if applicable)
  - Emit notifications

#### Updated Webhook Handler:
Handle these events (per Stripe best practices):
- `checkout.session.completed` - Primary success event
- `payment_intent.succeeded` - Fallback for direct PaymentIntent flows
- `payment_intent.payment_failed` - Payment failure
- `charge.refunded` - Refund handling
- `customer.subscription.created` - If subscriptions used
- `customer.subscription.deleted` - Subscription cancellation
- `invoice.payment_succeeded` - Recurring billing
- `invoice.payment_failed` - Recurring billing failure

#### Webhook Security:
- Verify signature using `STRIPE_WEBHOOK_SECRET`
- Idempotency: check if event already processed (store event IDs)
- Return 200 quickly, process asynchronously if heavy
- Log all events for audit trail

### 2.6 Updated Controller (`src/modules/payments/payments.controller.ts`)
- `POST /payments/checkout-session` - Create Checkout Session
- `POST /payments/webhook` - Handle Stripe webhooks (unchanged, SkipThrottle)
- `GET /payments/history` - Payment history (unchanged)
- Add Swagger annotations
- Raw body handling for webhook (ensure NestJS configured with `rawBody: true`)

### 2.7 Updated Repository (`src/modules/payments/payments.repository.ts`)
- `findByCheckoutSessionId(sessionId)`: Find by session ID
- `markEventProcessed(eventId)`: Track processed webhook events for idempotency
- `isEventProcessed(eventId)`: Check for duplicate events

### 2.8 Webhook Event Tracking Schema
Add `webhook_events` table:
- `id`, `stripeEventId` (unique), `eventType`, `processedAt`, `createdAt`
- Prevents duplicate processing from webhook retries

---

## Phase 3: Integration & Infrastructure

### 3.1 Module Registration
- Register `CartModule` in `app.module.ts`
- Update `PaymentsModule` to import `CartModule`
- Ensure `TypeOrmModule.forFeature` includes new entities

### 3.2 Migration
- Generate migration for: `carts`, `cart_items`, `webhook_events` tables
- Add columns to existing `payments` table
- Migration name: `add-cart-and-webhook-tracking`

### 3.3 Environment Variables
Add to env validation:
- `STRIPE_WEBHOOK_SECRET` (required for webhook verification)
- `STRIPE_SUCCESS_URL` (default success redirect)
- `STRIPE_CANCEL_URL` (default cancel redirect)
- `FRONTEND_URL` (for constructing URLs)

### 3.4 Stripe Configuration Updates
- Update `StripeProvider` to use RAK (restricted API key) pattern
- Add IP allowlist recommendation in docs
- Configure webhook endpoint in Stripe Dashboard:
  - URL: `/payments/webhook`
  - Events: `checkout.session.completed`, `payment_intent.*`, `charge.refunded`, `customer.subscription.*`, `invoice.*`

### 3.5 Jobs Module Integration
- Update stale payment reconciliation job to handle Checkout Sessions
- Add cart cleanup job (abandoned carts older than X days)

---

## Phase 4: Testing & Validation

### 4.1 Unit Tests
- `cart.service.spec.ts`: Test all cart operations, stock validation, price calculation
- `payments.service.spec.ts`: Test checkout session creation, webhook handling, idempotency
- Mock Stripe SDK responses

### 4.2 E2E Tests
- Cart flow: add, update, remove, clear, get
- Checkout flow: create session, mock webhook completion
- Webhook security: invalid signature, duplicate events

### 4.3 Stripe CLI Testing
- Use `stripe listen --forward-to localhost:3000/payments/webhook` for local testing
- Trigger test events: `stripe trigger checkout.session.completed`

---

## File Structure

```
src/
├── cart/
│   ├── schema/
│   │   ├── cart.schema.ts
│   │   └── cart-item.schema.ts
│   ├── dto/
│   │   ├── add-to-cart.dto.ts
│   │   ├── update-cart-item.dto.ts
│   │   └── cart-response.dto.ts
│   ├── cart.repository.ts
│   ├── cart.service.ts
│   ├── cart.controller.ts
│   └── cart.module.ts
│
├── modules/payments/
│   ├── schema/
│   │   └── payment.schema.ts (updated)
│   ├── types/
│   │   └── stripe.types.ts (updated)
│   ├── dto/
│   │   ├── create-payment-intent.dto.ts (existing)
│   │   └── create-checkout-session.dto.ts (new)
│   ├── payments.repository.ts (updated)
│   ├── payments.service.ts (updated)
│   ├── payments.controller.ts (updated)
│   └── payments.module.ts (updated)
│
db/migrations/
└── XXX-add-cart-and-webhook-tracking.ts
```

---

## Key Design Decisions

1. **Checkout Sessions over PaymentIntents**: Stripe's recommended approach for on-session payments, handles taxes, dynamic payment methods automatically
2. **Server-side price validation**: NEVER trust client-sent amounts; always fetch from Product entity
3. **Webhook idempotency**: Track processed event IDs to prevent duplicate processing
4. **Cart as ephemeral**: No soft deletes; cart cleared after successful checkout
5. **Stock validation at cart time**: Prevent adding out-of-stock items, but re-validate at checkout
6. **Restricted API Keys**: Use RAKs with minimum permissions per Stripe security best practices
7. **No `payment_method_types`**: Omit to enable dynamic payment methods (Stripe best practice)
8. **Raw body handling**: Ensure NestJS configured with `rawBody: true` for webhook signature verification

---

## Risks & Mitigations

1. **Webhook signature verification failure**: Ensure raw body is passed correctly, not JSON-parsed
2. **Duplicate webhook events**: Use event ID tracking for idempotency
3. **Cart-product price drift**: Store price snapshot at checkout time
4. **Stock changes between cart and checkout**: Re-validate stock before creating checkout session
5. **Stripe API version changes**: Pin API version in Stripe SDK initialization

---

## Implementation Order

1. Cart schema, DTOs, repository
2. Cart service, controller, module
3. Payments schema updates, new DTOs
4. Payments service (checkout session creation)
5. Payments webhook handler (all events)
6. Payments controller updates
7. Database migration
8. Module registration in app.module.ts
9. Unit tests
10. E2E tests
11. Stripe CLI integration testing
12. Documentation updates
