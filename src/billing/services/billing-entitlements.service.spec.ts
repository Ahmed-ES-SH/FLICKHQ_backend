import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BillingEntitlementsService } from './billing-entitlements.service';
import { BillingEntitlement } from '../entities/billing-entitlement.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingPlan } from '../entities/billing-plan.entity';
import { BillingPrice } from '../entities/billing-price.entity';
import {
  BillingEntitlementSourceType,
  BillingPaymentStatus,
  BillingSubscriptionStatus,
} from '../common/billing.enums';

interface EntitlementRepoMock {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

interface SubscriptionRepoMock {
  find: jest.Mock;
}

interface PaymentRepoMock {
  find: jest.Mock;
}

interface PlanRepoMock {
  findOne: jest.Mock;
}

interface PriceRepoMock {
  findOne: jest.Mock;
}

describe('BillingEntitlementsService', () => {
  let service: BillingEntitlementsService;
  let entitlementRepo: EntitlementRepoMock;
  let subscriptionRepo: SubscriptionRepoMock;
  let paymentRepo: PaymentRepoMock;
  let planRepo: PlanRepoMock;
  let priceRepo: PriceRepoMock;

  beforeEach(async () => {
    entitlementRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as BillingEntitlement),
      save: jest.fn((entity) => Promise.resolve(entity as BillingEntitlement)),
    };
    subscriptionRepo = { find: jest.fn() };
    paymentRepo = { find: jest.fn() };
    planRepo = { findOne: jest.fn() };
    priceRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingEntitlementsService,
        {
          provide: getRepositoryToken(BillingEntitlement),
          useValue: entitlementRepo,
        },
        {
          provide: getRepositoryToken(BillingSubscription),
          useValue: subscriptionRepo,
        },
        {
          provide: getRepositoryToken(BillingPayment),
          useValue: paymentRepo,
        },
        {
          provide: getRepositoryToken(BillingPlan),
          useValue: planRepo,
        },
        {
          provide: getRepositoryToken(BillingPrice),
          useValue: priceRepo,
        },
      ],
    }).compile();

    service = module.get(BillingEntitlementsService);
  });

  // ─────────────────────────────────────────────────────────────────
  // Static policy
  // ─────────────────────────────────────────────────────────────────

  describe('grantingStatuses', () => {
    it('includes active, trialing, past_due', () => {
      expect(BillingEntitlementsService.grantingStatuses).toEqual(
        expect.arrayContaining([
          BillingSubscriptionStatus.ACTIVE,
          BillingSubscriptionStatus.TRIALING,
          BillingSubscriptionStatus.PAST_DUE,
        ]),
      );
    });

    it('excludes paused, canceled, unpaid, incomplete, incomplete_expired', () => {
      expect(BillingEntitlementsService.grantingStatuses).not.toContain(
        BillingSubscriptionStatus.PAUSED,
      );
      expect(BillingEntitlementsService.grantingStatuses).not.toContain(
        BillingSubscriptionStatus.CANCELED,
      );
      expect(BillingEntitlementsService.grantingStatuses).not.toContain(
        BillingSubscriptionStatus.UNPAID,
      );
      expect(BillingEntitlementsService.grantingStatuses).not.toContain(
        BillingSubscriptionStatus.INCOMPLETE,
      );
      expect(BillingEntitlementsService.grantingStatuses).not.toContain(
        BillingSubscriptionStatus.INCOMPLETE_EXPIRED,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // canAccess
  // ─────────────────────────────────────────────────────────────────

  describe('canAccess', () => {
    it('returns true when an active row with no endsAt (lifetime) exists', async () => {
      entitlementRepo.findOne.mockResolvedValueOnce({ id: 'ent-1' });
      await expect(service.canAccess(42, 'premium_reports')).resolves.toBe(
        true,
      );
      const call = entitlementRepo.findOne.mock.calls[0][0];
      expect(call).toMatchObject({
        where: expect.arrayContaining([
          expect.objectContaining({
            userId: 42,
            featureKey: 'premium_reports',
            active: true,
          }),
        ]),
        select: { id: true },
      });
    });

    it('returns true when an active row with a recent endsAt exists (within grace period)', async () => {
      entitlementRepo.findOne.mockResolvedValueOnce({ id: 'ent-2' });
      await expect(service.canAccess(42, 'expiring_feature')).resolves.toBe(
        true,
      );
    });

    it('returns false when no row exists', async () => {
      entitlementRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.canAccess(42, 'unknown')).resolves.toBe(false);
    });

    it('returns false for invalid userId', async () => {
      await expect(service.canAccess(0, 'x')).resolves.toBe(false);
      await expect(service.canAccess(-1, 'x')).resolves.toBe(false);
      expect(entitlementRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns false for empty featureKey', async () => {
      await expect(service.canAccess(42, '')).resolves.toBe(false);
      expect(entitlementRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // getUserEntitlements
  // ─────────────────────────────────────────────────────────────────

  describe('getUserEntitlements', () => {
    it('returns active rows ordered by featureKey', async () => {
      const rows = [
        { id: 'a', featureKey: 'reports' },
        { id: 'b', featureKey: 'export' },
      ];
      entitlementRepo.find.mockResolvedValueOnce(rows);
      const out = await service.getUserEntitlements(42);
      expect(out).toBe(rows);
      expect(entitlementRepo.find).toHaveBeenCalledWith({
        where: { userId: 42, active: true },
        order: { featureKey: 'ASC' },
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // recomputeForUser
  // ─────────────────────────────────────────────────────────────────

  describe('recomputeForUser', () => {
    const subPlan = {
      id: 'plan-1',
      code: 'pro',
      features: ['premium_reports', 'team_export'],
    };
    const oneTimePlan = {
      id: 'plan-2',
      code: 'lifetime',
      features: ['lifetime_support'],
    };

    const activeSubscription = {
      id: 'sub-1',
      userId: 42,
      planId: 'plan-1',
      priceId: 'price-1',
      status: BillingSubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
    };

    const trialingSubscription = {
      id: 'sub-2',
      userId: 42,
      planId: 'plan-1',
      priceId: 'price-1',
      status: BillingSubscriptionStatus.TRIALING,
      currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
    };

    const pastDueSubscription = {
      id: 'sub-3',
      userId: 42,
      planId: 'plan-1',
      priceId: 'price-1',
      status: BillingSubscriptionStatus.PAST_DUE,
      currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
    };

    const pausedSubscription = {
      id: 'sub-4',
      userId: 42,
      planId: 'plan-1',
      priceId: 'price-1',
      status: BillingSubscriptionStatus.PAUSED,
      currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
    };

    const canceledSubscription = {
      id: 'sub-5',
      userId: 42,
      planId: 'plan-1',
      priceId: 'price-1',
      status: BillingSubscriptionStatus.CANCELED,
      currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
    };

    const oneTimePayment = {
      id: 'pay-1',
      userId: 42,
      priceId: 'price-2',
      status: BillingPaymentStatus.SUCCEEDED,
      createdAt: new Date('2024-01-15T00:00:00Z'),
    };

    it('with no subscriptions and no payments leaves the user with no active entitlements', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([]);
      paymentRepo.find.mockResolvedValueOnce([]);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);

      expect(result).toEqual({ added: 0, removed: 0, kept: 0 });
      expect(entitlementRepo.save).not.toHaveBeenCalled();
    });

    it('grants features from an active subscription', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([activeSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);

      expect(result.added).toBe(2);
      expect(result.removed).toBe(0);
      expect(result.kept).toBe(0);

      const created = entitlementRepo.create.mock.calls.map(
        ([dto]) => dto as Partial<BillingEntitlement>,
      );
      expect(created).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 42,
            featureKey: 'premium_reports',
            sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
            sourceId: 'sub-1',
            active: true,
            endsAt: activeSubscription.currentPeriodEnd,
          }),
          expect.objectContaining({
            userId: 42,
            featureKey: 'team_export',
            sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
            sourceId: 'sub-1',
            active: true,
          }),
        ]),
      );
    });

    it('grants features from a trialing subscription', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([trialingSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(2);
    });

    it('grants features from a past_due subscription', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([pastDueSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(2);
    });

    it('does not grant features from a paused subscription', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([pausedSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(0);
    });

    it('does not grant features from a canceled subscription', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([canceledSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(0);
    });

    it('grants features from a succeeded one-time payment', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([]);
      paymentRepo.find.mockResolvedValueOnce([oneTimePayment]);
      priceRepo.findOne.mockResolvedValueOnce({
        id: 'price-2',
        planId: 'plan-2',
      });
      planRepo.findOne.mockResolvedValueOnce(oneTimePlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);

      expect(result.added).toBe(1);
      const created = entitlementRepo.create.mock.calls.map(
        ([dto]) => dto as Partial<BillingEntitlement>,
      );
      expect(created[0]).toEqual(
        expect.objectContaining({
          userId: 42,
          featureKey: 'lifetime_support',
          sourceType: BillingEntitlementSourceType.ONE_TIME_PAYMENT,
          sourceId: 'pay-1',
          active: true,
          endsAt: null,
        }),
      );
    });

    it('is idempotent: second run with same state adds nothing', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([activeSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      // First run: no existing active rows.
      entitlementRepo.find.mockResolvedValueOnce([]);

      const first = await service.recomputeForUser(42);
      expect(first.added).toBe(2);

      // Second run: re-seed mocks. Active rows match the
      // recomputed expected set.
      const activeRows = [
        {
          id: 'e1',
          userId: 42,
          featureKey: 'premium_reports',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          active: true,
          startsAt: activeSubscription.currentPeriodStart,
          endsAt: activeSubscription.currentPeriodEnd,
        },
        {
          id: 'e2',
          userId: 42,
          featureKey: 'team_export',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          active: true,
          startsAt: activeSubscription.currentPeriodStart,
          endsAt: activeSubscription.currentPeriodEnd,
        },
      ];
      subscriptionRepo.find.mockResolvedValueOnce([activeSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce(activeRows);

      const second = await service.recomputeForUser(42);
      expect(second).toEqual({ added: 0, removed: 0, kept: 2 });
    });

    it('deactivates stale rows for a canceled subscription', async () => {
      // The user previously had an active subscription; the
      // webhook has now flipped it to canceled.
      subscriptionRepo.find.mockResolvedValueOnce([]);
      paymentRepo.find.mockResolvedValueOnce([]);
      entitlementRepo.find.mockResolvedValueOnce([
        {
          id: 'stale-1',
          userId: 42,
          featureKey: 'premium_reports',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-canceled',
          active: true,
          startsAt: new Date(),
          endsAt: new Date(),
        },
        {
          id: 'stale-2',
          userId: 42,
          featureKey: 'team_export',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-canceled',
          active: true,
          startsAt: new Date(),
          endsAt: new Date(),
        },
      ]);

      const result = await service.recomputeForUser(42);
      expect(result.removed).toBe(2);

      const saved = entitlementRepo.save.mock.calls.map(
        ([row]) => row as Partial<BillingEntitlement>,
      );
      const deactivated = saved.filter((r) => r.active === false);
      expect(deactivated).toHaveLength(2);
      deactivated.forEach((row) => {
        expect(row.endsAt).toBeInstanceOf(Date);
      });
    });

    it('reactivates a historical (deactivated) row on resubscribe', async () => {
      // An inactive row for the same (user, feature, source)
      // tuple already exists. The recompute should reactivate it
      // rather than inserting a new row.
      subscriptionRepo.find.mockResolvedValueOnce([activeSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);
      entitlementRepo.findOne
        .mockResolvedValueOnce({
          id: 'historical',
          userId: 42,
          featureKey: 'premium_reports',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          active: false,
          startsAt: new Date('2023-12-01T00:00:00Z'),
          endsAt: new Date('2023-12-31T00:00:00Z'),
        })
        .mockResolvedValueOnce(null);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(2);

      const saved = entitlementRepo.save.mock.calls.map(
        ([row]) => row as Partial<BillingEntitlement>,
      );
      const reactivated = saved.find((r) => r.id === 'historical');
      expect(reactivated).toMatchObject({
        active: true,
        startsAt: activeSubscription.currentPeriodStart,
        endsAt: activeSubscription.currentPeriodEnd,
      });
    });

    it('preserves manual grants during deactivation', async () => {
      subscriptionRepo.find.mockResolvedValueOnce([]);
      paymentRepo.find.mockResolvedValueOnce([]);
      entitlementRepo.find.mockResolvedValueOnce([
        {
          id: 'manual-1',
          userId: 42,
          featureKey: 'admin_feature',
          sourceType: BillingEntitlementSourceType.MANUAL,
          sourceId: null,
          active: true,
          startsAt: null,
          endsAt: null,
        },
      ]);

      const result = await service.recomputeForUser(42);
      expect(result.removed).toBe(0);
      const saved = entitlementRepo.save.mock.calls.map(
        ([row]) => row as Partial<BillingEntitlement>,
      );
      const deactivated = saved.filter((r) => r.active === false);
      expect(deactivated).toHaveLength(0);
    });

    it('falls back to empty feature list when subscription has no planId', async () => {
      const orphan = {
        id: 'sub-orphan',
        userId: 42,
        planId: null,
        priceId: null,
        status: BillingSubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
      };
      subscriptionRepo.find.mockResolvedValueOnce([orphan]);
      paymentRepo.find.mockResolvedValueOnce([]);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(0);
      expect(planRepo.findOne).not.toHaveBeenCalled();
    });

    it('falls back to empty feature list when payment has no priceId', async () => {
      const orphanPayment = {
        id: 'pay-orphan',
        userId: 42,
        priceId: null,
        status: BillingPaymentStatus.SUCCEEDED,
        createdAt: new Date(),
      };
      subscriptionRepo.find.mockResolvedValueOnce([]);
      paymentRepo.find.mockResolvedValueOnce([orphanPayment]);
      entitlementRepo.find.mockResolvedValueOnce([]);

      const result = await service.recomputeForUser(42);
      expect(result.added).toBe(0);
      expect(priceRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not write to users (no user repository is injected)', async () => {
      // The service constructor accepts only entitlement,
      // subscription, payment, plan, and price repos. We assert
      // this indirectly by exercising the recompute path and
      // verifying nothing accesses an unrelated table.
      subscriptionRepo.find.mockResolvedValueOnce([activeSubscription]);
      paymentRepo.find.mockResolvedValueOnce([]);
      planRepo.findOne.mockResolvedValueOnce(subPlan);
      entitlementRepo.find.mockResolvedValueOnce([]);

      await service.recomputeForUser(42);

      // Only the five declared repos were touched.
      expect(subscriptionRepo.find).toHaveBeenCalledTimes(1);
      expect(paymentRepo.find).toHaveBeenCalledTimes(1);
      expect(planRepo.findOne).toHaveBeenCalledTimes(1);
      expect(priceRepo.findOne).not.toHaveBeenCalled();
      expect(entitlementRepo.find).toHaveBeenCalledTimes(1);
    });
  });
});
