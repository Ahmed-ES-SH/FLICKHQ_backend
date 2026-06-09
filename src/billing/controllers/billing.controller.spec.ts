/**
 * HTTP-layer tests for `BillingController`.
 *
 * These tests do not hit the database — they bypass it via the
 * mocked services. The goal is to verify the route wiring, DTO
 * mapping, and dependency on the authenticated user.
 */

import { Test, TestingModule } from '@nestjs/testing';

import { BillingController } from './billing.controller';
import { BillingCustomerService } from '../services/billing-customer.service';
import { BillingPortalService } from '../services/billing-portal.service';
import { BillingCheckoutService } from '../services/billing-checkout.service';
import { BillingEntitlementsService } from '../services/billing-entitlements.service';
import { BillingCustomer } from '../entities/billing-customer.entity';
import { BillingEntitlement } from '../entities/billing-entitlement.entity';
import { BillingEntitlementSourceType } from '../common/billing.enums';

interface ServiceMocks {
  customer: {
    getOrCreateForUser: jest.Mock;
    syncForUser: jest.Mock;
  };
  portal: {
    createSessionForUser: jest.Mock;
  };
  checkout: {
    createOneTimeCheckout: jest.Mock;
    createSubscriptionCheckout: jest.Mock;
  };
  entitlements: {
    getUserEntitlements: jest.Mock;
  };
}

describe('BillingController', () => {
  let controller: BillingController;
  let mocks: ServiceMocks;

  const sampleCustomer: BillingCustomer = {
    id: 'cust-1',
    userId: 7,
    stripeCustomerId: 'cus_stripe_1',
    email: 'u@example.com',
    name: 'User',
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    mocks = {
      customer: {
        getOrCreateForUser: jest.fn(),
        syncForUser: jest.fn(),
      },
      portal: {
        createSessionForUser: jest.fn(),
      },
      checkout: {
        createOneTimeCheckout: jest.fn(),
        createSubscriptionCheckout: jest.fn(),
      },
      entitlements: {
        getUserEntitlements: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingCustomerService,
          useValue: mocks.customer,
        },
        {
          provide: BillingPortalService,
          useValue: mocks.portal,
        },
        {
          provide: BillingCheckoutService,
          useValue: mocks.checkout,
        },
        {
          provide: BillingEntitlementsService,
          useValue: mocks.entitlements,
        },
      ],
    }).compile();

    controller = module.get(BillingController);
  });

  describe('getCustomer', () => {
    it('returns the current user’s customer DTO', async () => {
      mocks.customer.getOrCreateForUser.mockResolvedValueOnce(sampleCustomer);
      const result = await controller.getCustomer({
        id: 7,
        email: 'u@example.com',
        role: 'user',
      });
      expect(result.userId).toBe(7);
      expect(result.stripeCustomerId).toBe('cus_stripe_1');
    });
  });

  describe('syncCustomer', () => {
    it('returns the freshly synced customer', async () => {
      mocks.customer.syncForUser.mockResolvedValueOnce({
        customer: sampleCustomer,
        created: true,
      });
      const result = await controller.syncCustomer({
        id: 7,
        email: 'u@example.com',
        role: 'user',
      });
      expect(result.userId).toBe(7);
    });
  });

  describe('createPortalSession', () => {
    it('returns the URL produced by the portal service', async () => {
      mocks.portal.createSessionForUser.mockResolvedValueOnce({
        url: 'https://billing.stripe.com/p/session/xxx',
      });
      const result = await controller.createPortalSession(
        {
          id: 7,
          email: 'u@example.com',
          role: 'user',
        },
        'idemp-1',
      );
      expect(result.url).toBe('https://billing.stripe.com/p/session/xxx');
      expect(mocks.portal.createSessionForUser).toHaveBeenCalledWith(
        7,
        'idemp-1',
      );
    });
  });

  describe('createOneTimeCheckout', () => {
    it('forwards the request to the checkout service with sane defaults', async () => {
      mocks.checkout.createOneTimeCheckout.mockResolvedValueOnce({
        sessionId: 'cs_test_one',
        url: 'https://checkout.stripe.com/c/pay/cs_test_one',
      });
      const result = await controller.createOneTimeCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-one',
        {
          priceId: '11111111-1111-1111-1111-111111111111',
          // quantity and allowPromotionCodes omitted on purpose
        },
      );
      expect(result.sessionId).toBe('cs_test_one');
      expect(mocks.checkout.createOneTimeCheckout).toHaveBeenCalledWith({
        userId: 7,
        priceId: '11111111-1111-1111-1111-111111111111',
        quantity: 1,
        allowPromotionCodes: true,
        idempotencyKey: 'idemp-one',
      });
    });

    it('forwards explicit quantity and allowPromotionCodes', async () => {
      mocks.checkout.createOneTimeCheckout.mockResolvedValueOnce({
        sessionId: 'cs_test_one_2',
        url: 'https://checkout.stripe.com/c/pay/cs_test_one_2',
      });
      await controller.createOneTimeCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-one-2',
        {
          priceId: '11111111-1111-1111-1111-111111111111',
          quantity: 3,
          allowPromotionCodes: false,
        },
      );
      expect(mocks.checkout.createOneTimeCheckout).toHaveBeenCalledWith({
        userId: 7,
        priceId: '11111111-1111-1111-1111-111111111111',
        quantity: 3,
        allowPromotionCodes: false,
        idempotencyKey: 'idemp-one-2',
      });
    });
  });

  describe('createSubscriptionCheckout', () => {
    it('forwards the request with the trialDays / clientReferenceId fields', async () => {
      mocks.checkout.createSubscriptionCheckout.mockResolvedValueOnce({
        sessionId: 'cs_test_sub',
        url: 'https://checkout.stripe.com/c/pay/cs_test_sub',
      });
      const result = await controller.createSubscriptionCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-sub',
        {
          priceId: '22222222-2222-2222-2222-222222222222',
          quantity: 2,
          clientReferenceId: 'order-123',
          trialDays: 14,
          allowPromotionCodes: true,
        },
      );
      expect(result.sessionId).toBe('cs_test_sub');
      expect(mocks.checkout.createSubscriptionCheckout).toHaveBeenCalledWith({
        userId: 7,
        priceId: '22222222-2222-2222-2222-222222222222',
        quantity: 2,
        clientReferenceId: 'order-123',
        trialDays: 14,
        allowPromotionCodes: true,
        idempotencyKey: 'idemp-sub',
      });
    });

    it('uses sane defaults when optional fields are absent', async () => {
      mocks.checkout.createSubscriptionCheckout.mockResolvedValueOnce({
        sessionId: 'cs_test_sub_2',
        url: 'https://checkout.stripe.com/c/pay/cs_test_sub_2',
      });
      await controller.createSubscriptionCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-sub-2',
        {
          priceId: '22222222-2222-2222-2222-222222222222',
        },
      );
      expect(mocks.checkout.createSubscriptionCheckout).toHaveBeenCalledWith({
        userId: 7,
        priceId: '22222222-2222-2222-2222-222222222222',
        quantity: 1,
        clientReferenceId: null,
        trialDays: null,
        allowPromotionCodes: true,
        idempotencyKey: 'idemp-sub-2',
      });
    });
  });

  describe('listEntitlements', () => {
    it('returns the active entitlement rows mapped to DTOs', async () => {
      const rows: BillingEntitlement[] = [
        {
          id: 'e1',
          userId: 7,
          featureKey: 'premium_reports',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          active: true,
          startsAt: new Date('2024-01-01T00:00:00Z'),
          endsAt: new Date('2024-02-01T00:00:00Z'),
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'e2',
          userId: 7,
          featureKey: 'team_export',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          active: true,
          startsAt: new Date('2024-01-01T00:00:00Z'),
          endsAt: new Date('2024-02-01T00:00:00Z'),
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mocks.entitlements.getUserEntitlements.mockResolvedValueOnce(rows);
      const result = await controller.listEntitlements({
        id: 7,
        email: 'u@example.com',
        role: 'user',
      });
      expect(mocks.entitlements.getUserEntitlements).toHaveBeenCalledWith(7);
      expect(result).toEqual([
        {
          featureKey: 'premium_reports',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          startsAt: new Date('2024-01-01T00:00:00Z'),
          endsAt: new Date('2024-02-01T00:00:00Z'),
        },
        {
          featureKey: 'team_export',
          sourceType: BillingEntitlementSourceType.SUBSCRIPTION,
          sourceId: 'sub-1',
          startsAt: new Date('2024-01-01T00:00:00Z'),
          endsAt: new Date('2024-02-01T00:00:00Z'),
        },
      ]);
    });

    it('returns an empty array when the user has no active entitlements', async () => {
      mocks.entitlements.getUserEntitlements.mockResolvedValueOnce([]);
      const result = await controller.listEntitlements({
        id: 99,
        email: 'nobody@example.com',
        role: 'user',
      });
      expect(result).toEqual([]);
      expect(mocks.entitlements.getUserEntitlements).toHaveBeenCalledWith(99);
    });
  });
});
