/**
 * BillingEntitlementsService
 *
 * Maps local billing state to application feature keys. The single
 * source of truth for "can this user use feature X?" — application
 * modules should depend on this service, not on Stripe status
 * fields or subscription rows directly.
 *
 * Source rows we read from:
 *
 * - `BillingSubscription` rows with a granting status
 *   (`active`, `trialing`, `past_due`). The `BillingPlan.features`
 *   array on the linked plan is projected into one entitlement per
 *   feature key.
 * - `BillingPayment` rows with `status = succeeded` and a
 *   non-null `priceId`. The `BillingPlan.features` of the linked
 *   price's plan is projected the same way.
 *
 * Source of truth:
 *
 * - The `active` boolean on `BillingEntitlement` is the runtime
 *   truth for `canAccess`. Time-window columns (`startsAt`,
 *   `endsAt`) are stored for support visibility but are not
 *   consulted in v1 — Stripe keeps the period fresh and we
 *   recompute on every state change.
 *
 * Recompute triggers:
 *
 * - `BillingWebhookService` calls `recomputeForUser(userId)` after
 *   the source-of-truth handlers: subscription lifecycle,
 *   payment-intent-succeeded, and invoice payment-failed.
 * - Application code can call `recomputeForUser` on demand (e.g.
 *   after seeding or admin repair) — the operation is idempotent.
 *
 * Out of scope for v1:
 *
 * - Manual `sourceType = 'manual'` grants. The enum is preserved
 *   for future use; recompute never writes to it. Existing manual
 *   rows (if any) are preserved verbatim.
 * - A partial unique index on the active rows. The service
 *   enforces the "one active row per
 *   (user, featureKey, sourceType, sourceId)" invariant in
 *   application logic.
 * - Per-feature expiry windows. `endsAt` is stored but
 *   `canAccess` does not consult it.
 *
 * `users.is_premium` is intentionally never written by this
 * service. It is a pre-existing compatibility column and will be
 * removed in a future cleanup migration.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';

import { BillingEntitlement } from '../entities/billing-entitlement.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingPlan } from '../entities/billing-plan.entity';
import { BillingPrice } from '../entities/billing-price.entity';
import {
  BillingEntitlementSourceType,
  BillingPaymentStatus,
  BillingPriceType,
  BillingSubscriptionStatus,
} from '../common/billing.enums';
import { ENTITLEMENT_GRANTING_STATUSES } from '../common/billing.constants';

export interface BillingEntitlementRecomputeResult {
  added: number;
  removed: number;
  kept: number;
}

interface ExpectedEntitlement {
  featureKey: string;
  sourceType: BillingEntitlementSourceType;
  sourceId: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

@Injectable()
export class BillingEntitlementsService {
  private readonly logger = new Logger(BillingEntitlementsService.name);

  /**
   * Set of `BillingSubscriptionStatus` values that grant
   * entitlements. Exposed (typed) for tests; the runtime filter
   * goes through `findActiveSubscriptions` which is internal.
   */
  static readonly grantingStatuses: readonly BillingSubscriptionStatus[] =
    ENTITLEMENT_GRANTING_STATUSES as readonly BillingSubscriptionStatus[];

  constructor(
    @InjectRepository(BillingEntitlement)
    private readonly entitlementRepository: Repository<BillingEntitlement>,
    @InjectRepository(BillingSubscription)
    private readonly subscriptionRepository: Repository<BillingSubscription>,
    @InjectRepository(BillingPayment)
    private readonly paymentRepository: Repository<BillingPayment>,
    @InjectRepository(BillingPlan)
    private readonly planRepository: Repository<BillingPlan>,
    @InjectRepository(BillingPrice)
    private readonly priceRepository: Repository<BillingPrice>,
  ) {}

  /**
   * True when the user has at least one active `BillingEntitlement`
   * row for `featureKey`. This is the cheap path used by
   * `FeatureAccessGuard`; the underlying query hits the
   * `(user_id, feature_key, source_type, active)` index.
   */
  async canAccess(userId: number, featureKey: string): Promise<boolean> {
    if (!Number.isInteger(userId) || userId <= 0) {
      return false;
    }
    if (typeof featureKey !== 'string' || featureKey.length === 0) {
      return false;
    }
    const now = new Date();
    // Add a 24-hour grace period to prevent locking out users due
    // to minor clock drifts or delayed webhook processing.
    const graceTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const existing = await this.entitlementRepository.findOne({
      where: [
        // Active with no end date (one-time/lifetime purchases).
        { userId, featureKey, active: true, endsAt: IsNull() },
        // Active with an end date that hasn't passed (plus grace period).
        { userId, featureKey, active: true, endsAt: MoreThan(graceTime) },
      ],
      select: { id: true },
    });
    return Boolean(existing);
  }

  /**
   * Active entitlements for a user. Used by the public endpoint
   * and (potentially) by admin/support tooling.
   */
  async getUserEntitlements(userId: number): Promise<BillingEntitlement[]> {
    return this.entitlementRepository.find({
      where: { userId, active: true },
      order: { featureKey: 'ASC' },
    });
  }

  /**
   * Recompute the active entitlement set for a single user from
   * the current local billing state.
   *
   * Algorithm:
   *
   * 1. Read all granting-status subscriptions and all succeeded
   *    one-time payments for the user.
   * 2. Resolve each row's `BillingPlan.features` (joining through
   *    the price when needed).
   * 3. Build the expected set of
   *    `(featureKey, sourceType, sourceId, startsAt, endsAt)`
   *    tuples.
   * 4. Upsert each expected row (reactivate + update time window
   *    if a row exists; insert if not).
   * 5. Find currently-active rows for the user that are not in
   *    the expected set. Set `active = false`, `endsAt = now`.
   * 6. Return `{ added, removed, kept }` counts for telemetry.
   *
   * The function is idempotent: running it twice in a row with no
   * underlying state change produces the same final set with
   * `added = 0` and `removed = 0` on the second run.
   *
   * Manual grants (rows with `sourceType = 'manual'`) are
   * preserved verbatim — they are never deactivated by the
   * recompute.
   */
  async recomputeForUser(
    userId: number,
  ): Promise<BillingEntitlementRecomputeResult> {
    const expected = await this.buildExpectedEntitlements(userId);

    const activeRows = await this.entitlementRepository.find({
      where: { userId, active: true },
    });

    const expectedKey = (e: ExpectedEntitlement): string =>
      `${e.featureKey}|${e.sourceType}|${e.sourceId}`;
    const expectedKeySet = new Set(expected.map(expectedKey));

    let added = 0;
    let kept = 0;

    for (const exp of expected) {
      const existing = activeRows.find(
        (r) =>
          r.featureKey === exp.featureKey &&
          r.sourceType === exp.sourceType &&
          r.sourceId === exp.sourceId,
      );
      if (existing) {
        let changed = false;
        if (existing.startsAt?.getTime() !== exp.startsAt?.getTime()) {
          existing.startsAt = exp.startsAt;
          changed = true;
        }
        if (existing.endsAt?.getTime() !== exp.endsAt?.getTime()) {
          existing.endsAt = exp.endsAt;
          changed = true;
        }
        if (changed) {
          await this.entitlementRepository.save(existing);
        }
        kept += 1;
        continue;
      }

      // Look for an inactive historical row to reactivate before
      // inserting. Same natural key: (user, feature, sourceType,
      // sourceId).
      const historical = await this.entitlementRepository.findOne({
        where: {
          userId,
          featureKey: exp.featureKey,
          sourceType: exp.sourceType,
          sourceId: exp.sourceId,
        },
      });
      if (historical) {
        historical.active = true;
        historical.startsAt = exp.startsAt;
        historical.endsAt = exp.endsAt;
        await this.entitlementRepository.save(historical);
      } else {
        const row = this.entitlementRepository.create({
          userId,
          featureKey: exp.featureKey,
          sourceType: exp.sourceType,
          sourceId: exp.sourceId,
          active: true,
          startsAt: exp.startsAt,
          endsAt: exp.endsAt,
          metadata: {},
        });
        await this.entitlementRepository.save(row);
      }
      added += 1;
    }

    let removed = 0;
    const now = new Date();
    for (const row of activeRows) {
      // Never touch manual grants — they are admin-controlled and
      // out of scope for v1.
      if (row.sourceType === BillingEntitlementSourceType.MANUAL) {
        continue;
      }
      const key = `${row.featureKey}|${row.sourceType}|${row.sourceId}`;
      if (expectedKeySet.has(key)) continue;
      row.active = false;
      row.endsAt = now;
      await this.entitlementRepository.save(row);
      removed += 1;
    }

    if (added > 0 || removed > 0) {
      this.logger.log(
        `Recomputed entitlements for user ${userId}: +${added} -${removed} =${kept} active`,
      );
    }

    return { added, removed, kept };
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  private async buildExpectedEntitlements(
    userId: number,
  ): Promise<ExpectedEntitlement[]> {
    const expected: ExpectedEntitlement[] = [];

    const subscriptions = await this.findGrantingSubscriptions(userId);
    for (const sub of subscriptions) {
      const features = await this.loadFeaturesForSubscription(sub);
      for (const featureKey of features) {
        expected.push({
          featureKey,
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: sub.id,
          startsAt: sub.currentPeriodStart ?? null,
          endsAt: sub.currentPeriodEnd ?? null,
        });
      }
    }

    const payments = await this.findSucceededOneTimePayments(userId);
    for (const payment of payments) {
      const features = await this.loadFeaturesForPayment(payment);
      for (const featureKey of features) {
        expected.push({
          featureKey,
          sourceType: BillingEntitlementSourceType.ONE_TIME_PAYMENT,
          sourceId: payment.id,
          startsAt: payment.createdAt ?? null,
          endsAt: null,
        });
      }
    }

    return expected;
  }

  private async findGrantingSubscriptions(
    userId: number,
  ): Promise<BillingSubscription[]> {
    const all = await this.subscriptionRepository.find({
      where: {
        userId,
        status: In([
          ...ENTITLEMENT_GRANTING_STATUSES,
        ] as BillingSubscriptionStatus[]),
      },
    });
    // Defensive post-filter: the WHERE clause already restricts
    // to granting statuses, but a stale row with a removed
    // status string (e.g. an enum migration) should never sneak
    // through and grant entitlements.
    const granting = new Set<BillingSubscriptionStatus>(
      ENTITLEMENT_GRANTING_STATUSES as readonly BillingSubscriptionStatus[],
    );
    return all.filter((sub) => granting.has(sub.status));
  }

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

  /**
   * Resolve the `BillingPlan.features` array for a subscription.
   * The subscription's `planId` is the plan we bill against (set
   * by the checkout service from the chosen price). When the
   * plan has been deleted since the subscription was created
   * (the `planId` is nullable on the entity), we fall back to an
   * empty feature list — the subscription still counts as
   * active for billing state, it just contributes no feature
   * keys.
   */
  private async loadFeaturesForSubscription(
    subscription: BillingSubscription,
  ): Promise<string[]> {
    if (!subscription.planId) return [];
    const plan = await this.planRepository.findOne({
      where: { id: subscription.planId },
    });
    return plan?.features ?? [];
  }

  /**
   * Resolve the `BillingPlan.features` array for a one-time
   * payment. Joins through `BillingPrice.planId`. Defensive: a
   * payment with no `priceId` contributes nothing (the `priceId`
   * filter is on the database query that finds succeeded
   * payments, but a stale row could still slip through).
   */
  private async loadFeaturesForPayment(
    payment: BillingPayment,
  ): Promise<string[]> {
    if (!payment.priceId) return [];
    const price = await this.priceRepository.findOne({
      where: { id: payment.priceId },
    });
    if (!price) return [];
    const plan = await this.planRepository.findOne({
      where: { id: price.planId },
    });
    return plan?.features ?? [];
  }
}
