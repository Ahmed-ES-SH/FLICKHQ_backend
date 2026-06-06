# Billing Module Audit Report

> **Project:** NestJS Boilerplate Backend  
> **Scope:** `src/billing/` (controllers, services, entities, common helpers, and Stripe configuration)  
> **Date:** 2026-06-06  
> **Audit Status:** Complete  
> **Primary Goal:** Hardening the Stripe Billing module, ensuring database transactional safety, avoiding lifetime feature leaks, preventing startup crashes, and handling zero-decimal currencies correctly.

---

## Executive Summary

The `src/billing` module implements a robust foundational Stripe billing integration, featuring skeleton structures, lean database persistence, webhook ingestion, customer portal redirections, and feature entitlement access checks. However, during a deep structural audit of the billing module, we identified several critical bugs and architectural issues that would cause failures in production. 

The most significant findings include:
- **Lifetime Premium Feature Leak:** Succeeded subscription payments are processed as succeeded one-time payments, permanently granting users lifetime access to features even if they cancel.
- **Permanent User Lockout:** Stuck `INCOMPLETE` subscription shells block subsequent checkout attempts due to strict active subscription guards.
- **Idempotency Race Conditions:** Concurrent retries of failed/expired idempotency keys bypass locking, causing parallel executions.
- **App Startup Crash:** Disabling billing via configuration (`BILLING_ENABLED=false`) still instantiates the Stripe provider, causing immediate application crashes if Stripe keys are missing.
- **Zero-Decimal Formatting Errors:** Hardcoded price division by 100 causes incorrect price strings for currencies like JPY.

---

## Findings Overview Table

| Severity | ID | Area | Issue Summary | Why It Matters |
| :--- | :--- | :--- | :--- | :--- |
| **Critical** | `[BILL-CRIT-01]` | `BillingEntitlementsService` | Subscription payments grant permanent one-time entitlements | Users who cancel their subscriptions keep premium access forever. |
| **Critical** | `[BILL-CRIT-02]` | `BillingCheckoutService` | Stuck `INCOMPLETE` subscription shells cause permanent checkout lockout | A failed Stripe API call or server crash leaves the user unable to subscribe again. |
| **High** | `[BILL-HIGH-01]` | `BillingIdempotencyService` | Race conditions in failed/expired key retries bypass idempotency | Concurrent retries run duplicate Stripe operations/charges. |
| **High** | `[BILL-HIGH-02]` | `StripeProvider` | Application crashes at startup when billing is disabled | Prevents booting the application when `BILLING_ENABLED=false` unless dummy keys are present. |
| **High** | `[BILL-HIGH-03]` | `BillingWebhookService` | Silent entitlement recomputation failure on webhook ingestion | If entitlement sync fails, the webhook returns `200 OK`, leaving state permanently out of sync. |
| **Medium** | `[BILL-MED-01]` | `BillingCheckoutService` | Hardcoded division by 100 formats zero-decimal currencies incorrectly | A JPY price of 500 Yen gets formatted and displayed to users as "5.00 JPY". |
| **Medium** | `[BILL-MED-02]` | `BillingEntitlementsService` | Missing runtime temporal window validation on entitlements | If a cancellation webhook is lost, the user gets free access forever because time limits are ignored. |
| **Medium** | `[BILL-MED-03]` | `BillingCustomerService` | Concurrent customer creation leaks orphaned Stripe Customers | Parallel first-time checkout requests trigger multiple Stripe customer creations. |

---

## Detailed Findings & Solutions

### `[BILL-CRIT-01]` Subscription Payments Grant Permanent One-Time Entitlements

* **File:** [billing-entitlements.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-entitlements.service.ts#L323-L332)
* **Severity:** Critical

#### Description
When recomputing entitlements, `findSucceededOneTimePayments` returns all payment records with `status = BillingPaymentStatus.SUCCEEDED`:
```typescript
  private async findSucceededOneTimePayments(
    userId: number,
  ): Promise<BillingPayment[]> {
    return this.paymentRepository.find({
      where: {
        userId,
        status: BillingPaymentStatus.SUCCEEDED,
      },
    });
  }
```
However, both one-time checkouts and subscription checkouts insert `BillingPayment` rows. Once the user pays their first subscription invoice/intent, the subscription payment status is marked `SUCCEEDED`. Since there is no filter checking the price type:
1. `findSucceededOneTimePayments` matches the subscription's payment record.
2. `recomputeForUser` resolves the linked plan features and registers them under `sourceType: BillingEntitlementSourceType.ONE_TIME_PAYMENT` with `endsAt: null` (lifetime).
3. The user gets lifetime entitlement access. If they cancel their subscription, the subscription-derived entitlement is deactivated, but the permanent one-time payment entitlement remains, leaking premium access forever.

#### Recommended Fix
Modify `findSucceededOneTimePayments` to eager-load the price relation and filter by `type = BillingPriceType.ONE_TIME`:
```typescript
  private async findSucceededOneTimePayments(
    userId: number,
  ): Promise<BillingPayment[]> {
    return this.paymentRepository.find({
      where: {
        userId,
        status: BillingPaymentStatus.SUCCEEDED,
        price: {
          type: BillingPriceType.ONE_TIME,
        },
      },
      relations: ['price'],
    });
  }
```

---

### `[BILL-CRIT-02]` Stuck Incomplete Subscription Shells Cause Permanent User Lockout

* **File:** [billing-checkout.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-checkout.service.ts#L308-L323)
* **Severity:** Critical

#### Description
During `createSubscriptionCheckout`, a `BillingSubscription` record is saved in the local database with `status = BillingSubscriptionStatus.INCOMPLETE` before initiating the Stripe API call `stripe.checkout.sessions.create`:
```typescript
      subscription = this.subscriptionRepository.create({
        userId: input.userId,
        billingCustomerId: customer.id,
        planId: price.planId,
        priceId: price.id,
        stripeSubscriptionId: placeholderSubscriptionId, // e.g. pending_sub:<paymentId>
        status: BillingSubscriptionStatus.INCOMPLETE,
        ...
      });
      subscription = await this.subscriptionRepository.save(subscription);
```
If the Stripe API call fails (due to a rate limit, temporary network issue, or key mismatch) or the server crashes, this shell is left in the DB as `INCOMPLETE`. 

Because `INCOMPLETE` is listed in `ACTIVE_SUBSCRIPTION_STATES`, any subsequent attempt by the user to subscribe will fail at `assertNoActiveSubscription`:
```typescript
  private async assertNoActiveSubscription(userId: number): Promise<void> {
    const existing = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(ACTIVE_SUBSCRIPTION_STATES),
      },
    });
    if (existing) {
      throw new ConflictException(...);
    }
  }
```
If the database write in the catch block fails (or is bypassed due to server crash), the user is permanently locked out from initiating new subscription checkouts until database intervention.

#### Recommended Fix
Ignore placeholder subscription shells during validation if they don't have a real Stripe Subscription ID:
```typescript
  private async assertNoActiveSubscription(userId: number): Promise<void> {
    const existing = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(ACTIVE_SUBSCRIPTION_STATES),
      },
    });
    if (existing && !this.isPlaceholderSubscriptionId(existing.stripeSubscriptionId)) {
      throw new ConflictException(
        `User ${userId} already has an active subscription (status=${existing.status}).`
      );
    }
  }
```

---

### `[BILL-HIGH-01]` Race Conditions in FAILED/EXPIRED Key Retries Bypass Idempotency

* **File:** [billing-idempotency.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-idempotency.service.ts#L239-L277)
* **Severity:** High

#### Description
If two concurrent requests hit `reserve` for a previously `FAILED` or `EXPIRED` idempotency key, they both check the status and then issue an unconditional `update` statement:
```typescript
      await this.idempotencyRepository.update(
        { key: existing.key },
        {
          status: BillingIdempotencyStatus.IN_PROGRESS,
          responseSnapshot: null,
          expiresAt: newExpiresAt,
        },
      );
```
Both updates succeed, and both requests return `retriable: true`. As a result, both concurrent requests proceed to run the actual payment/subscription checkout operations on Stripe, causing duplicate charges.

#### Recommended Fix
Perform a conditional update checking the status, and classify as in-flight if the status was changed:
```typescript
      const updateResult = await this.idempotencyRepository.update(
        { 
          key: existing.key, 
          status: In([BillingIdempotencyStatus.FAILED, BillingIdempotencyStatus.EXPIRED]) 
        },
        {
          status: BillingIdempotencyStatus.IN_PROGRESS,
          responseSnapshot: null,
          expiresAt: newExpiresAt,
        },
      );

      if (updateResult.affected === 0) {
        // Another concurrent request beat us to flipping it to IN_PROGRESS.
        throw new BillingIdempotencyInFlightError(existing.key);
      }
```

---

### `[BILL-HIGH-02]` Application Crashes at Startup When Billing is Disabled

* **Files:** [stripe.config.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/config/stripe.config.ts#L171-L195) and [billing.module.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/billing.module.ts#L137-L143)
* **Severity:** High

#### Description
In `app.module.ts`, `BillingModule` is imported directly. During bootstrap, NestJS instantiates all registered providers, including the `STRIPE_CLIENT` provider. 
The provider calls `resolveStripeKey(configService)`:
```typescript
export function resolveStripeKey(config: ConfigService) {
  ...
  throw new Error(
    'Stripe is enabled but no key was provided. Set STRIPE_RESTRICTED_KEY (preferred) or STRIPE_SECRET_KEY.',
  );
}
```
If `BILLING_ENABLED` is set to `false` in `.env`, the environment validation allows omitting Stripe keys. However, because the provider still boots, the application crashes immediately with a startup error unless dummy keys are provided.

#### Recommended Fix
Modify `StripeProvider` to check `BILLING_ENABLED` and return a mock/proxy client if disabled:
```typescript
export const StripeProvider = {
  provide: 'STRIPE_CLIENT',

  useFactory: (configService: ConfigService): StripeInstance | null => {
    const enabled = configService.get<string>('BILLING_ENABLED') !== 'false';
    if (!enabled) {
      // Return a Proxy that throws warnings/errors on actual method invocation
      return new Proxy({} as any, {
        get: () => {
          return () => {
            throw new Error('Stripe is disabled via BILLING_ENABLED configuration.');
          };
        },
      });
    }

    const { key, mode } = resolveStripeKey(configService);
    assertKeyModeMatchesEnv(mode, configService);
    ...
  },
  inject: [ConfigService],
};
```

---

### `[BILL-HIGH-03]` Silent Entitlement Recomputation Failure on Webhook Ingestion

* **File:** [billing-webhook.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-webhook.service.ts#L1293-L1303)
* **Severity:** High

#### Description
In `billing-webhook.service.ts`, the `recomputeEntitlements` helper logs failures but swallows them, allowing the webhook to return `PROCESSED`:
```typescript
  private async recomputeEntitlements(userId: number): Promise<void> {
    try {
      await this.entitlementsService.recomputeForUser(userId);
    } catch (err) {
      this.logger.error(
        `Entitlement recompute failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }
```
Because the error is caught, `dispatch` returns successfully. The webhook endpoint returns `200 OK` to Stripe. Stripe will consider the event fully processed and will never retry it. If a temporary database deadlock occurred during entitlement sync, the user's entitlements remain stale, meaning they paid but did not receive their subscription benefits.

#### Recommended Fix
Propagate the error to fail the webhook, forcing Stripe to retry:
```typescript
  private async recomputeEntitlements(userId: number): Promise<void> {
    // Let the error bubble up so that the webhook handler fails with 5xx
    // and Stripe retries delivery.
    await this.entitlementsService.recomputeForUser(userId);
  }
```

---

### `[BILL-MED-01]` Hardcoded Division by 100 Formats Zero-Decimal Currencies Incorrectly

* **File:** [billing-checkout.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-checkout.service.ts#L506-L517)
* **Severity:** Medium

#### Description
The functions `buildOneTimeDescription` and `buildSubscriptionDescription` format description strings by dividing the minor unit amount by 100:
```typescript
  private buildOneTimeDescription(price: BillingPrice): string {
    const minor = price.unitAmount;
    const major = (minor / 100).toFixed(2);
    return `One-time payment: ${price.stripePriceId} (${major} ${price.currency.toUpperCase()})`;
  }
```
This is incorrect for zero-decimal currencies (like JPY or KRW) where minor units equal major units. For instance, a subscription priced at `500 JPY` has `unitAmount = 500`. The code formats this as `5.00 JPY` in the payment description, showing incorrect pricing metadata to the user and billing audit records.

#### Recommended Fix
Utilize the existing `formatMinorAmount` helper in `money.util.ts`, which respects currency-specific fraction digits:
```typescript
  private buildOneTimeDescription(price: BillingPrice): string {
    const formatted = formatMinorAmount(price.unitAmount, price.currency);
    return `One-time payment: ${price.stripePriceId} (${formatted})`;
  }

  private buildSubscriptionDescription(price: BillingPrice): string {
    const formatted = formatMinorAmount(price.unitAmount, price.currency);
    const interval = price.interval ?? 'period';
    return `Subscription: ${price.stripePriceId} (${formatted} / ${interval})`;
  }
```

---

### `[BILL-MED-02]` Missing Runtime Temporal Window Validation on Entitlements

* **File:** [billing-entitlements.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-entitlements.service.ts#L113-L125)
* **Severity:** Medium

#### Description
The runtime gate `canAccess` checks only the `active = true` flag on the `BillingEntitlement` entity:
```typescript
  async canAccess(userId: number, featureKey: string): Promise<boolean> {
    ...
    const existing = await this.entitlementRepository.findOne({
      where: { userId, featureKey, active: true },
      select: { id: true },
    });
    return Boolean(existing);
  }
```
If a subscription cancellation webhook is lost, failed, or delayed, the database row's `active` flag remains `true`. Because the runtime gate does not inspect the `endsAt` date column (relying entirely on webhooks to flip `active` to `false`), the user continues to get free premium access indefinitely.

#### Recommended Fix
Implement temporal boundary checks as a passive fallback at runtime:
```typescript
  async canAccess(userId: number, featureKey: string): Promise<boolean> {
    if (!Number.isInteger(userId) || userId <= 0) {
      return false;
    }
    if (typeof featureKey !== 'string' || featureKey.length === 0) {
      return false;
    }

    const now = new Date();
    // Add a 24-hour grace period to prevent locking out users due to minor clock drifts
    const graceTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const existing = await this.entitlementRepository.findOne({
      where: [
        { userId, featureKey, active: true, endsAt: IsNull() },
        { userId, featureKey, active: true, endsAt: MoreThan(graceTime) },
      ],
      select: { id: true },
    });
    return Boolean(existing);
  }
```

---

### `[BILL-MED-03]` Concurrent Customer Creation Leaks Orphaned Stripe Customers

* **File:** [billing-customer.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/billing/services/billing-customer.service.ts#L98-L154)
* **Severity:** Medium

#### Description
If a user without a customer row triggers parallel requests (e.g. concurrent checkout clicks or rapid page loading), both calls in `getOrCreateForUser` find that no local customer row exists. Both execute:
```typescript
    const stripeCustomer = await this.stripeService.safeCall(() =>
      this.stripeService.getClient().customers.create(...)
    );
```
Stripe creates two customers. In `createLocalRow`, the first request saves successfully. The second request catches the database unique constraint violation on `user_id` and falls back to returning the first customer. However, the second customer created in Stripe is never referenced, linked, or deleted, leading to orphaned customers leaking on Stripe.

#### Recommended Fix
Wrap the check and creation within a write lock on the User row to serialize requests:
```typescript
  async getOrCreateForUser(userId: number): Promise<BillingCustomer> {
    return this.customerRepository.manager.transaction(async (manager) => {
      // 1. SELECT FOR UPDATE to acquire a write lock on the user row
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // 2. Check if the customer row was created concurrently
      const existing = await manager.findOne(BillingCustomer, { where: { userId } });
      if (existing) {
        return existing;
      }

      // 3. Create Stripe Customer and save local row (same as existing logic)
      ...
    });
  }
```

---

## Conclusion

By addressing these findings, the `src/billing` module will be fully secure, crash-safe, race-free, and support multi-currency formatting out of the box. 

We recommend implementing:
1. The **`price.type` filter** in `findSucceededOneTimePayments` to stop the lifetime entitlement leak.
2. The **placeholder check** in `assertNoActiveSubscription` to prevent stuck checkouts.
3. The **conditional update** pattern in `BillingIdempotencyService` to lock concurrent requests safely.
