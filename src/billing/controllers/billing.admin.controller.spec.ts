/**
 * HTTP-layer tests for the admin billing controller. Verifies
 * that DTOs are passed through to the catalog service and that
 * the response shape is correctly assembled.
 *
 * The `AuthGuard` and `RolesGuard` applied at the controller
 * level are stubbed to no-op via `jest.mock` so the test stays
 * focused on the controller's own logic. Guard behavior is
 * covered by integration tests in Phase 8. Stubbing at the
 * module boundary also avoids loading the `auth` module
 * transitively (which pulls in `UserService` and its
 * `src/helpers/paginate.helper` path-alias import that the
 * unit-test Jest config does not resolve).
 */

jest.mock('../../auth/guards/auth.guard', () => ({
  AuthGuard: class AuthGuard {
    canActivate(): boolean {
      return true;
    }
  },
}));

jest.mock('../../auth/guards/roles.guard', () => ({
  RolesGuard: class RolesGuard {
    canActivate(): boolean {
      return true;
    }
  },
}));

import { Test, TestingModule } from '@nestjs/testing';

import { BillingAdminController } from './billing.admin.controller';
import { BillingCatalogService } from '../services/billing-catalog.service';
import { BillingAdminService } from '../services/billing-admin.service';
import {
  BillingPlanStatus,
  BillingPriceType,
  BillingRecurringInterval,
  BillingWebhookEventStatus,
} from '../common/billing.enums';

describe('BillingAdminController', () => {
  let controller: BillingAdminController;
  let catalog: jest.Mocked<BillingCatalogService>;
  let admin: jest.Mocked<BillingAdminService>;

  const samplePlan = {
    id: 'plan-1',
    code: 'pro_monthly',
    name: 'Pro',
    description: null,
    status: BillingPlanStatus.ACTIVE,
    features: ['premium_reports'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const samplePrice = {
    id: 'price-1',
    planId: 'plan-1',
    stripePriceId: 'price_1',
    stripeProductId: null,
    currency: 'usd',
    unitAmount: 1999,
    type: BillingPriceType.RECURRING,
    interval: BillingRecurringInterval.MONTH,
    trialPeriodDays: null,
    active: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingAdminController],
      providers: [
        {
          provide: BillingCatalogService,
          useValue: {
            createPlan: jest.fn(),
            updatePlan: jest.fn(),
            archivePlan: jest.fn(),
            addPrice: jest.fn(),
            getPlanWithPrices: jest.fn(),
            listAllPlans: jest.fn(),
          },
        },
        {
          provide: BillingAdminService,
          useValue: {
            getOverview: jest.fn(),
            listFailedWebhooks: jest.fn(),
            replayWebhook: jest.fn(),
            refundPayment: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(BillingAdminController);
    catalog = module.get(BillingCatalogService);
    admin = module.get(BillingAdminService);
  });

  // ─────────────────────────────────────────────
  // Phase 3 — Plan management
  // ─────────────────────────────────────────────

  describe('createPlan', () => {
    it('calls the service and returns the plan with its prices', async () => {
      catalog.createPlan.mockResolvedValueOnce(samplePlan as never);
      catalog.getPlanWithPrices.mockResolvedValueOnce({
        plan: samplePlan as never,
        prices: [samplePrice],
      });
      const result = await controller.createPlan({
        code: 'pro_monthly',
        name: 'Pro',
      });
      expect(result.plan.id).toBe('plan-1');
      expect(result.plan.prices).toHaveLength(1);
    });
  });

  describe('updatePlan', () => {
    it('returns the updated plan with its prices', async () => {
      catalog.updatePlan.mockResolvedValueOnce(samplePlan as never);
      catalog.getPlanWithPrices.mockResolvedValueOnce({
        plan: samplePlan as never,
        prices: [samplePrice],
      });
      const result = await controller.updatePlan('plan-1', {
        name: 'New',
      });
      expect(result.plan.id).toBe('plan-1');
    });
  });

  describe('archivePlan', () => {
    it('returns the archived plan with its prices', async () => {
      catalog.archivePlan.mockResolvedValueOnce({
        ...samplePlan,
        status: BillingPlanStatus.ARCHIVED,
      } as never);
      catalog.getPlanWithPrices.mockResolvedValueOnce({
        plan: { ...samplePlan, status: BillingPlanStatus.ARCHIVED } as never,
        prices: [],
      });
      const result = await controller.archivePlan('plan-1');
      expect(result.plan.status).toBe(BillingPlanStatus.ARCHIVED);
      expect(result.plan.prices).toEqual([]);
    });
  });

  describe('addPrice', () => {
    it('adds a price and returns the plan with the new price included', async () => {
      catalog.addPrice.mockResolvedValueOnce(samplePrice);
      catalog.getPlanWithPrices.mockResolvedValueOnce({
        plan: samplePlan as never,
        prices: [samplePrice],
      });
      const result = await controller.addPrice('plan-1', {
        stripePriceId: 'price_1',
        currency: 'USD',
        unitAmount: 1999,
        type: BillingPriceType.RECURRING,
        interval: BillingRecurringInterval.MONTH,
      });
      expect(result.plan.prices).toHaveLength(1);
    });
  });

  describe('listPlans', () => {
    it('returns whatever the service returns', async () => {
      const list = [
        {
          id: 'plan-1',
          code: 'pro_monthly',
          name: 'Pro',
          description: null,
          status: BillingPlanStatus.ACTIVE,
          features: [],
          prices: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      catalog.listAllPlans.mockResolvedValueOnce(list);
      const result = await controller.listPlans({
        status: BillingPlanStatus.ACTIVE,
      });
      expect(result).toBe(list);
    });
  });

  // ─────────────────────────────────────────────
  // Phase 7 — Overview
  // ─────────────────────────────────────────────

  describe('getOverview', () => {
    it('returns the overview from the admin service', async () => {
      const overview = {
        totalCustomers: 5,
        subscriptionsByStatus: [
          { status: 'active', count: 3 },
          { status: 'trialing', count: 1 },
        ],
        recentFailedPayments: [],
        failedWebhooksCount: 2,
      };
      admin.getOverview.mockResolvedValueOnce(overview);
      const result = await controller.getOverview();
      expect(result).toBe(overview);
    });
  });

  // ─────────────────────────────────────────────
  // Phase 7 — Failed webhooks
  // ─────────────────────────────────────────────

  describe('listFailedWebhooks', () => {
    it('returns the failed webhooks from the admin service', async () => {
      const failedList = {
        data: [
          {
            id: 'wh-1',
            stripeEventId: 'evt_1',
            eventType: 'payment_intent.succeeded',
            errorMessage: 'error',
            processingAttempts: 2,
            status: BillingWebhookEventStatus.FAILED,
            receivedAt: new Date(),
            processedAt: null,
          },
        ],
        total: 1,
      };
      admin.listFailedWebhooks.mockResolvedValueOnce(failedList);
      const result = await controller.listFailedWebhooks();
      expect(result).toBe(failedList);
    });
  });

  describe('replayWebhook', () => {
    it('returns the replay result on success', async () => {
      admin.replayWebhook.mockResolvedValueOnce({
        kind: 'processed',
        stripeEventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
      });
      const result = await controller.replayWebhook('wh-1');
      expect(result.result.kind).toBe('processed');
      expect(result.result.stripeEventId).toBe('evt_1');
    });

    it('returns a failed result when the event does not exist', async () => {
      admin.replayWebhook.mockResolvedValueOnce(null);
      const result = await controller.replayWebhook('nonexistent');
      expect(result.result.kind).toBe('failed');
      expect(result.result.reason).toContain('not found');
    });
  });

  // ─────────────────────────────────────────────
  // Phase 7 — Refund
  // ─────────────────────────────────────────────

  describe('refundPayment', () => {
    it('forwards the request to the admin service with the idempotency key', async () => {
      admin.refundPayment.mockResolvedValueOnce({
        transactionId: 'tx-1',
        stripeRefundId: 're_1',
        amount: 500,
        currency: 'usd',
        status: 'succeeded',
      });
      const result = await controller.refundPayment('pay-1', 'idemp-1', {
        amount: 500,
      });
      expect(result.transactionId).toBe('tx-1');
      expect(admin.refundPayment).toHaveBeenCalledWith('pay-1', 'idemp-1', 500);
    });

    it('forwards the request without amount when not provided', async () => {
      admin.refundPayment.mockResolvedValueOnce({
        transactionId: 'tx-2',
        stripeRefundId: 're_2',
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
      });
      const result = await controller.refundPayment('pay-2', 'idemp-2', {
        amount: undefined,
      });
      expect(result.amount).toBe(1000);
      expect(admin.refundPayment).toHaveBeenCalledWith(
        'pay-2',
        'idemp-2',
        undefined,
      );
    });
  });
});
