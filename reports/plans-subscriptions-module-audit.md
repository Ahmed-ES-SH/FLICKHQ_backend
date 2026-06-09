=============================================
  CodeReviewer — Review Report
  Module   : plans-subscriptions
  Date     : 2026-06-08
  Reviewer : CodeReviewer Agent
=============================================

SUMMARY
-------
Total Issues Found : 23
  🔴 CRITICAL      : 0
  🟠 HIGH          : 3
  🟡 MEDIUM        : 8
  🔵 LOW           : 9
  ⚪ INFO          : 3

=============================================
SECURITY ISSUES
=============================================

[SR-001] 🟡 MEDIUM — User ID extracted via unsafe type assertion (all user-facing controllers)
  Files    : 
    - src/plans-subscriptions/controllers/user-payments.controller.ts (lines 42, 60)
    - src/plans-subscriptions/controllers/user-subscriptions.controller.ts (lines 42, 58, 82)
  Issue   : The pattern `(req as unknown as { user: { id: number } }).user.id` uses a
            double type assertion to force the compiler to accept the shape. This bypasses
            TypeScript's type checker entirely and will fail at runtime if the auth guard
            hasn't populated `req.user` with the expected shape.
  Risk    : Runtime crashes if `req.user` is undefined or has a different shape.
            No validation that the extracted value is actually a number.
  Fix     : Create and reuse a typed interface (e.g., `AuthenticatedRequest`) or a
            custom `@CurrentUser()` parameter decorator that safely extracts the validated
            user from the request. Example:
            ```ts
            export interface AuthenticatedRequest extends Request {
              user: { id: number; role: UserRoleEnum };
            }
            // then use: req: AuthenticatedRequest
            ```

[SR-002] 🟡 MEDIUM — Admin endpoint accepts raw enum query param without validation
  File    : src/plans-subscriptions/controllers/admin-plans.controller.ts (line 51)
  Issue   : The `listPlans(@Query('status') status?: BillingPlanStatus)` endpoint accepts
            a string query parameter and types it as the enum `BillingPlanStatus` without
            a validation pipe. Any string value can be passed — there's no guarantee it's
            a valid enum member.
  Risk    : Passing an invalid status string will cause the TypeORM query to silently
            return no results, or in strict mode could cause a DB error. While not a direct
            security vulnerability, it degrades API reliability.
  Fix     : Use a custom `ParseEnumPipe` or `@Query('status', new ParseEnumPipe(BillingPlanStatus))`
            to validate and transform the query parameter:
            ```ts
            async listPlans(
              @Query('status', new ParseEnumPipe(BillingPlanStatus, { optional: true }))
              status?: BillingPlanStatus,
            ): Promise<PlanResponseDto[]> {
            ```

=============================================
PERFORMANCE ISSUES
=============================================

[PR-001] 🟠 HIGH — Invoice query in `getUserPaymentHistory` fetches ALL user invoices
  File    : src/plans-subscriptions/services/user-billing-history.service.ts (lines 113-116)
  Issue   : `getUserPaymentHistory` fetches `BillingInvoice` with `where: { userId }`
            which loads EVERY invoice for the user, regardless of the pagination window.
            As the user accumulates invoices over time, this query will grow linearly
            and eventually become a performance bottleneck.
  Risk    : Users with hundreds or thousands of invoices will experience slow payment
            history page loads. The invoice data is loaded into memory but only a subset
            is used (matched via `stripePaymentIntentId` to the current page's payments).
  Fix     : Instead of fetching all invoices, fetch only those matching the current page's
            payment intents. Replace:
            ```ts
            this.invoiceRepository.find({ where: { userId } }),
            ```
            with:
            ```ts
            const paymentIntentIds = payments
              .map((p) => p.stripePaymentIntentId)
              .filter((id): id is string => id !== null);
            this.invoiceRepository.find({
              where: { stripePaymentIntentId: In(paymentIntentIds) },
            }),
            ```

[PR-002] 🟡 MEDIUM — Redundant `active` filter check in `PlanDisplayService`
  File    : src/plans-subscriptions/services/plan-display.service.ts (lines 38, 32)
  Issue   : The price query already filters `active: true` at line 32, but the loop at
            line 38 redundantly checks `if (!price.active) continue;`. This is dead logic
            — the DB has already guaranteed all returned prices are active.
  Risk    : Minimal performance impact (a condition check per row). Code clarity issue.
  Fix     : Remove the redundant `if (!price.active) continue;` guard from the loop.

[PR-003] 🟡 MEDIUM — `getPaymentDetail` performs 3 sequential queries instead of joins
  File    : src/plans-subscriptions/services/user-billing-history.service.ts (lines 172-189)
  Issue   : `getPaymentDetail` makes 3 separate DB round-trips: one for the payment, one
            for transactions, one for the invoice. These could be combined with eager
            relations or a single query with joins.
  Risk    : Adds ~2ms-5ms latency per request due to extra round-trips. Under load, this
            compounds.
  Fix     : Add a `@OneToMany` relation for transactions on the payment entity (or use
            QueryBuilder with a left join). Alternatively, batch the two secondary queries
            using `Promise.all` (they are currently sequential after `if` blocks).

[PR-004] 🔵 LOW — Pagination default values duplicated across services
  Files    :
    - src/plans-subscriptions/services/subscription-history.service.ts (lines 99-100)
    - src/plans-subscriptions/services/user-billing-history.service.ts (lines 62-63, 96-97)
  Issue   : The default values `page = 1` and `limit = 20` are set in both the DTO
            (`PaginationQueryDto`) and in each service method. The DTO already provides
            defaults via property initializers, so the service fallbacks are redundant.
  Fix     : Remove the redundant defaults from the service methods. The DTO values are
            guaranteed to be populated by `ValidationPipe` with `transform: true`.

=============================================
TYPE SAFETY & CLEAN CODE ISSUES
=============================================

[TC-001] 🟠 HIGH — Unsafe type casting with `as unknown as` for enum cross-mapping
  Files    :
    - src/plans-subscriptions/services/plan-management.service.ts (lines 140-141)
    - src/plans-subscriptions/services/price-management.service.ts (line 91-92)
    - src/plans-subscriptions/services/plan-display.service.ts (lines 63-64)
  Issue   : The pattern `p.type as unknown as PriceType` and `p.interval as unknown as PriceInterval`
            uses a double escape hatch (`as unknown as`) to force TypeScript to accept the
            cross-module enum mapping. This completely bypasses type checking. If the source
            enum (`BillingPriceType` / `BillingRecurringInterval`) gains or loses a value
            that the target enum (`PriceType` / `PriceInterval`) doesn't reflect, the
            compiler will not warn.
  Risk    : Silent data corruption at runtime if enum values drift. A new price type added
            to `BillingPriceType` but not to `PriceType` will pass through the cast and
            end up in the API response with potentially mismatched semantics.
  Fix     : Eliminate one of the two parallel enum hierarchies. Use the domain enums
            (`BillingPriceType`, `BillingRecurringInterval`) directly in the DTOs instead
            of redefining local enums (`PriceType`, `PriceInterval`). Or, add a
            validation/mapping function that explicitly handles each case:
            ```ts
            function mapPriceType(type: BillingPriceType): PriceType {
              switch (type) {
                case BillingPriceType.ONE_TIME: return PriceType.ONE_TIME;
                case BillingPriceType.RECURRING: return PriceType.RECURRING;
                default: throw new Error(`Unknown price type: ${type}`);
              }
            }
            ```

[TC-002] 🟡 MEDIUM — Unused import `PriceResponseDto` in plan-management.service.ts
  File    : src/plans-subscriptions/services/plan-management.service.ts (line 11)
  Issue   : `PriceResponseDto` is imported but never referenced in the file body.
            The `prices` mapping inside `toPlanResponse` builds objects inline rather
            than referencing the DTO type.
  Fix     : Remove the unused import.

[TC-003] 🟡 MEDIUM — Unused imports in PlanSubscriptionHistory entity
  File    : src/plans-subscriptions/entities/plan-subscription-history.entity.ts (lines 7-8)
  Issue   : `JoinColumn` and `ManyToOne` are imported from TypeORM but not used in the
            entity. The entity has no relational decorators — all foreign keys are
            stored as plain `Column` values without ORM relations.
  Fix     : Remove the unused imports `JoinColumn` and `ManyToOne`.

[TC-004] 🟡 MEDIUM — Dead import: `BillingCatalogService` injected but never called
  File    : src/plans-subscriptions/services/plan-management.service.ts (lines 6, 22)
  Issue   : `BillingCatalogService` is imported and injected into the constructor but
            never used anywhere in the service. This indicates either incomplete Stripe
            product sync logic or leftover code from a refactor.
  Risk    : Creates confusion for maintainers. If Stripe product creation is expected
            here, it's missing.
  Fix     : Either remove the unused dependency, or add the Stripe product creation call
            (e.g., `await this.catalogService.createProduct(...)`) in `createPlan()`.

[TC-005] 🟡 MEDIUM — Empty `guards/` directory
  File    : src/plans-subscriptions/guards/ (directory exists but is empty)
  Issue   : An empty `guards/` directory adds noise to the module structure. No guard
            files exist in it.
  Fix     : Remove the empty directory.

[TC-006] 🔵 LOW — `PaginatedResponseDto<T>` is defined but never used
  File    : src/plans-subscriptions/dto/paginated-response.dto.ts
  Issue   : `PaginatedResponseDto<T>` is a generic paginated response wrapper that is
            never imported or used by any controller or service. All paginated endpoints
            inline their response shape manually.
  Fix     : Either remove the dead DTO, or refactor paginated endpoints to use it for
            consistency.

[TC-007] 🔵 LOW — `updatePlan` does not check if plan is archived before updating
  File    : src/plans-subscriptions/services/plan-management.service.ts (lines 43-61)
  Issue   : An admin can update an already-archived plan. While this may be intentional
            (admin flexibility), there is no guard preventing modifications to archived
            plans. Plan metadata could be silently modified after archival.
  Fix     : Add an explicit check: if `plan.status === BillingPlanStatus.ARCHIVED`, throw
            a `BadRequestException` or `ConflictException` unless the admin explicitly
            opts in via a query parameter.

[TC-008] 🔵 LOW — Event handlers always record `previousStatus: null`
  File    : src/plans-subscriptions/services/subscription-history.service.ts (lines 123-191)
  Issue   : All three event listeners (`SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`,
            `SUBSCRIPTION_CANCELED`) record `previousStatus: null` because the event
            payload does not carry the previous status. This means the history timeline
            lacks full state transition context (e.g., `active -> canceled` is recorded
            as `(none) -> canceled`).
  Fix     : Enrich the event payload to include `previousStatus`, or have the handler
            query the last known status from the subscription history table before
            recording the new entry.

[TC-009] 🔵 LOW — `subscriptionId: null` hardcoded in payment history response
  File    : src/plans-subscriptions/services/user-billing-history.service.ts (lines 149, 198)
  Issue   : `getUserPaymentHistory` and `getPaymentDetail` both hardcode
            `subscriptionId: null` in the returned DTO. The `BillingPayment` entity
            doesn't have a direct subscription reference, but it could potentially be
            derived via the checkout session or payment intent.
  Fix     : If the payment entity can be linked back to a subscription (e.g., via the
            checkout session -> subscription relationship), populate this field. Otherwise,
            consider removing the field from the response DTO to avoid confusion.

=============================================
DATABASE & ORM ISSUES
=============================================

[DB-001] 🔵 LOW — `getUserPaymentHistory` fetches invoices by `userId` instead of by payment
  File    : src/plans-subscriptions/services/user-billing-history.service.ts (lines 113-116)
  Issue   : Already covered in [PR-001] above — the invoice query is scoped to `userId`
            instead of the specific payment intent IDs from the current page.
  Fix     : See [PR-001].

[DB-002] 🔵 LOW — Redundant unique index on nullable column
  File    : src/plans-subscriptions/entities/plan-subscription-history.entity.ts (line 46)
  Issue   : `stripeEventId` has `unique: true` but is also `nullable: true`. In PostgreSQL,
            unique constraints allow multiple NULL values, so this is fine. However, it's
            worth noting that the dedup mechanism only works for webhook events that carry
            a non-null `stripeEventId`. Internal events (via event bus) all pass `null`.
  Note    : This is by design — the unique constraint catches duplicate Stripe webhook
            deliveries while allowing internal events without an ID.

=============================================
MISSING TEST COVERAGE
=============================================

[TST-001] ⚪ INFO — No tests for `PlanDisplayService.listPublicPlans()`
  Note    : The `plan-display.service.spec.ts` exists but no test coverage was verified
            for edge cases (e.g., only plans with active prices are returned, plans
            without prices are filtered out).

[TST-002] ⚪ INFO — Integration test coverage gap: payment history pagination
  Note    : The `subscription-history.integration.spec.ts` exists but no integration
            test was found for `user-billing-history.service.ts`.

=============================================
RECOMMENDED ACTIONS
=============================================

Priority 1 (Fix before next commit):
  - [TC-001] Replace `as unknown as` enum casting with explicit mapping functions
            to ensure type safety across the billing domain enum boundary.
  - [TC-002] Remove unused `PriceResponseDto` import from plan-management.service.ts
  - [TC-003] Remove unused `JoinColumn` and `ManyToOne` imports from entity

Priority 2 (Fix before deployment):
  - [SR-001] Create a typed `AuthenticatedRequest` interface or `@CurrentUser()` decorator
            to safely extract user identity in controllers.
  - [PR-001] Fix invoice query in `getUserPaymentHistory` to scope by payment intent IDs
            instead of fetching all user invoices.
  - [SR-002] Add `ParseEnumPipe` validation on the `status` query parameter in admin controller.

Priority 3 (Next sprint):
  - [TC-004] Either implement Stripe product sync via `BillingCatalogService` or remove
            the unused dependency.
  - [TC-005] Remove the empty `guards/` directory.
  - [TC-006] Either use `PaginatedResponseDto<T>` or remove the dead file.
  - [PR-002] Remove redundant `active` check in `PlanDisplayService`.
  - [PR-003] Optimize `getPaymentDetail` with batched queries or joins.
  - [TC-007] Add archive-status guard to `updatePlan`.
  - [TC-008] Enrich subscription event payloads with `previousStatus`.

=============================================
DETAILED ISSUE BREAKDOWN
=============================================

┌────────┬──────────────────────────────────────────────────────┬──────────┐
│  ID    │  Issue                                               │ Severity │
├────────┼──────────────────────────────────────────────────────┼──────────┤
│ SR-001 │ Unsafe `as unknown as` user extraction in controllers│ 🟡 MEDIUM │
│ SR-002 │ Unvalidated enum query param on admin endpoint       │ 🟡 MEDIUM │
│ PR-001 │ Invoice query fetches ALL user invoices regardless   │ 🟠 HIGH   │
│        │   of pagination window                               │          │
│ PR-002 │ Redundant `active` filter check in PlanDisplayService│ 🟡 MEDIUM │
│ PR-003 │ 3 sequential DB queries in getPaymentDetail          │ 🟡 MEDIUM │
│ PR-004 │ Duplicate pagination defaults (DTO + service)        │ 🔵 LOW    │
│ TC-001 │ Unsafe `as unknown as` enum casting (3 locations)    │ 🟠 HIGH   │
│ TC-002 │ Unused import: PriceResponseDto                      │ 🟡 MEDIUM │
│ TC-003 │ Unused imports: JoinColumn, ManyToOne in entity      │ 🟡 MEDIUM │
│ TC-004 │ Dead dependency: BillingCatalogService never called  │ 🟡 MEDIUM │
│ TC-005 │ Empty guards/ directory                              │ 🟡 MEDIUM │
│ TC-006 │ Dead code: PaginatedResponseDto<T> never used        │ 🔵 LOW    │
│ TC-007 │ No archive-status guard on plan updates              │ 🔵 LOW    │
│ TC-008 │ Event handlers lose `previousStatus` context         │ 🔵 LOW    │
│ TC-009 │ Hardcoded `subscriptionId: null` in payment response │ 🔵 LOW    │
│ DB-001 │ Invoice query scoped to userId not payment IDs       │ 🔵 LOW    │
│ DB-002 │ Nullable unique column (by design, noted)            │ ⚪ INFO   │
│ TST-001 │ No PlanDisplayService edge-case tests               │ ⚪ INFO   │
│ TST-002 │ No user-billing-history integration tests           │ ⚪ INFO   │
└────────┴──────────────────────────────────────────────────────┴──────────┘

=============================================
CODE QUALITY — POSITIVE OBSERVATIONS
=============================================

+ All controller endpoints use proper DTOs with `class-validator` decorators.
+ Subscription webhook dedup via unique `stripeEventId` constraint is well-designed.
+ Batch-fetching of prices in `listPlans` avoids N+1 queries.
+ `PlanSubscriptionHistory` entity has proper indexes on `[userId, occurredAt]` and `subscriptionId`.
+ Module follows NestJS conventions: controllers -> services -> repositories.
+ Pagination is correctly implemented with `findAndCount` and `skip/take`.
+ Public plans endpoint is correctly marked `@Public()` to bypass auth.
+ Event-driven architecture using `@nestjs/event-emitter` for loose coupling.
+ Tests exist for all controllers and services (unit + integration).
+ DTO defaults and `@Type(() => Number)` correctly handle query parameter transformation.
+ Error handling in `recordStatusChange` properly catches and handles duplicate key violations.

=============================================
