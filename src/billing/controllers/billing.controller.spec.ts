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
import { BillingStripeService } from '../services/billing-stripe.service';
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
    createSubscriptionPaymentIntent: jest.Mock;
    createSubscriptionFromPayment: jest.Mock;
  };
  entitlements: {
    getUserEntitlements: jest.Mock;
  };
  stripeService: {
    getClient: jest.Mock;
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
    const mockStripeClient = {
      checkout: {
        sessions: {
          retrieve: jest.fn(),
        },
      },
    };

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
        createSubscriptionPaymentIntent: jest.fn(),
        createSubscriptionFromPayment: jest.fn(),
      },
      entitlements: {
        getUserEntitlements: jest.fn(),
      },
      stripeService: {
        getClient: jest.fn().mockReturnValue(mockStripeClient),
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
        {
          provide: BillingStripeService,
          useValue: mocks.stripeService,
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

  describe('createEmbeddedElementsCheckout (subscription — PaymentIntent-first)', () => {
    const mockPaymentIntentId = 'pi_3RabcDEFghijklmn';
    const mockClientSecret = 'pi_3RabcDEFghijklmn_secret_XYZ123abcDEFghijklmn';

    it('returns paymentIntentId and clientSecret on success', async () => {
      mocks.checkout.createSubscriptionPaymentIntent.mockResolvedValueOnce({
        paymentIntentId: mockPaymentIntentId,
        clientSecret: mockClientSecret,
      });

      const result = await controller.createEmbeddedElementsCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-emb-sub',
        {
          priceId: '33333333-3333-3333-3333-333333333333',
          quantity: 1,
        },
      );

      expect(result.paymentIntentId).toBe(mockPaymentIntentId);
      expect(result.clientSecret).toBe(mockClientSecret);
      expect(
        mocks.checkout.createSubscriptionPaymentIntent,
      ).toHaveBeenCalledWith({
        userId: 7,
        priceId: '33333333-3333-3333-3333-333333333333',
        quantity: 1,
        clientReferenceId: null,
        idempotencyKey: 'idemp-emb-sub',
      });
    });

    it('forwards Idempotency-Key to the service', async () => {
      mocks.checkout.createSubscriptionPaymentIntent.mockResolvedValueOnce({
        paymentIntentId: mockPaymentIntentId,
        clientSecret: mockClientSecret,
      });

      await controller.createEmbeddedElementsCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'custom-idemp-key',
        {
          priceId: '33333333-3333-3333-3333-333333333333',
        },
      );

      expect(
        mocks.checkout.createSubscriptionPaymentIntent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'custom-idemp-key',
        }),
      );
    });

    it('forwards clientReferenceId when provided', async () => {
      mocks.checkout.createSubscriptionPaymentIntent.mockResolvedValueOnce({
        paymentIntentId: mockPaymentIntentId,
        clientSecret: mockClientSecret,
      });

      await controller.createEmbeddedElementsCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-ref',
        {
          priceId: '33333333-3333-3333-3333-333333333333',
          clientReferenceId: 'order-abc-123',
        },
      );

      expect(
        mocks.checkout.createSubscriptionPaymentIntent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          clientReferenceId: 'order-abc-123',
        }),
      );
    });

    it('uses defaults when optional fields are absent', async () => {
      mocks.checkout.createSubscriptionPaymentIntent.mockResolvedValueOnce({
        paymentIntentId: mockPaymentIntentId,
        clientSecret: mockClientSecret,
      });

      await controller.createEmbeddedElementsCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-defaults',
        {
          priceId: '33333333-3333-3333-3333-333333333333',
        },
      );

      expect(
        mocks.checkout.createSubscriptionPaymentIntent,
      ).toHaveBeenCalledWith({
        userId: 7,
        priceId: '33333333-3333-3333-3333-333333333333',
        quantity: 1,
        clientReferenceId: null,
        idempotencyKey: 'idemp-defaults',
      });
    });
  });

  describe('createEmbeddedElementsOneTimeCheckout', () => {
    const mockSessionId = 'cs_test_emb_ot';
    const mockClientSecret = 'pi_3Rxyz_secret_DEF456';

    it('returns sessionId and clientSecret on success', async () => {
      mocks.checkout.createOneTimeCheckout.mockResolvedValueOnce({
        sessionId: mockSessionId,
        url: 'https://checkout.stripe.com/c/pay/cs_test_emb_ot',
      });

      const mockRetrieve = jest.mocked(
        mocks.stripeService.getClient().checkout.sessions.retrieve,
      );
      mockRetrieve.mockResolvedValueOnce({
        id: mockSessionId,
        payment_intent: {
          client_secret: mockClientSecret,
        },
      } as never);

      const result = await controller.createEmbeddedElementsOneTimeCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-emb-ot',
        {
          priceId: '44444444-4444-4444-4444-444444444444',
          quantity: 2,
          allowPromotionCodes: false,
        },
      );

      expect(result.sessionId).toBe(mockSessionId);
      expect(result.clientSecret).toBe(mockClientSecret);
      expect(mocks.checkout.createOneTimeCheckout).toHaveBeenCalledWith({
        userId: 7,
        priceId: '44444444-4444-4444-4444-444444444444',
        quantity: 2,
        allowPromotionCodes: false,
        idempotencyKey: 'idemp-emb-ot',
      });
    });

    it('forwards explicit fields and idempotency key', async () => {
      mocks.checkout.createOneTimeCheckout.mockResolvedValueOnce({
        sessionId: mockSessionId,
        url: 'https://checkout.stripe.com/c/pay/cs_test_emb_ot',
      });

      const mockRetrieve = jest.mocked(
        mocks.stripeService.getClient().checkout.sessions.retrieve,
      );
      mockRetrieve.mockResolvedValueOnce({
        id: mockSessionId,
        payment_intent: {
          client_secret: mockClientSecret,
        },
      } as never);

      await controller.createEmbeddedElementsOneTimeCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'custom-ot-key',
        {
          priceId: '44444444-4444-4444-4444-444444444444',
        },
      );

      expect(mocks.checkout.createOneTimeCheckout).toHaveBeenCalledWith({
        userId: 7,
        priceId: '44444444-4444-4444-4444-444444444444',
        quantity: 1,
        allowPromotionCodes: true,
        idempotencyKey: 'custom-ot-key',
      });
    });

    it('throws InternalServerErrorException when PaymentIntent is null', async () => {
      mocks.checkout.createOneTimeCheckout.mockResolvedValueOnce({
        sessionId: mockSessionId,
        url: 'https://checkout.stripe.com/c/pay/cs_test_emb_ot',
      });

      const mockRetrieve = jest.mocked(
        mocks.stripeService.getClient().checkout.sessions.retrieve,
      );
      mockRetrieve.mockResolvedValueOnce({
        id: mockSessionId,
        payment_intent: null,
      } as never);

      await expect(
        controller.createEmbeddedElementsOneTimeCheckout(
          { id: 7, email: 'u@example.com', role: 'user' },
          'idemp-emb-ot-null',
          {
            priceId: '44444444-4444-4444-4444-444444444444',
          },
        ),
      ).rejects.toThrow('Failed to retrieve PaymentIntent clientSecret');
    });

    it('retrieves session with expand parameter', async () => {
      mocks.checkout.createOneTimeCheckout.mockResolvedValueOnce({
        sessionId: mockSessionId,
        url: 'https://checkout.stripe.com/c/pay/cs_test_emb_ot',
      });

      const mockRetrieve = jest.mocked(
        mocks.stripeService.getClient().checkout.sessions.retrieve,
      );
      mockRetrieve.mockResolvedValueOnce({
        id: mockSessionId,
        payment_intent: {
          client_secret: mockClientSecret,
        },
      } as never);

      await controller.createEmbeddedElementsOneTimeCheckout(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-emb-ot-expand',
        {
          priceId: '44444444-4444-4444-4444-444444444444',
        },
      );

      const mockRetrieveFn = jest.mocked(
        mocks.stripeService.getClient().checkout.sessions.retrieve,
      );
      expect(mockRetrieveFn).toHaveBeenCalledWith(mockSessionId, {
        expand: ['payment_intent'],
      });
    });
  });

  describe('createSubscriptionFromPayment', () => {
    const mockPaymentIntentId = 'pi_3RabcDEFghijklmn';
    const mockSubscriptionId = 'sub_1XYZabc';
    const mockStatus = 'active';

    it('returns subscriptionId and status on success', async () => {
      mocks.checkout.createSubscriptionFromPayment.mockResolvedValueOnce({
        subscriptionId: mockSubscriptionId,
        status: mockStatus,
      });

      const result = await controller.createSubscriptionFromPayment(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-sub-create',
        { paymentIntentId: mockPaymentIntentId },
      );

      expect(result.subscriptionId).toBe(mockSubscriptionId);
      expect(result.status).toBe(mockStatus);
      expect(
        mocks.checkout.createSubscriptionFromPayment,
      ).toHaveBeenCalledWith({
        userId: 7,
        paymentIntentId: mockPaymentIntentId,
        idempotencyKey: 'idemp-sub-create',
      });
    });

    it('forwards Idempotency-Key to the service', async () => {
      mocks.checkout.createSubscriptionFromPayment.mockResolvedValueOnce({
        subscriptionId: mockSubscriptionId,
        status: mockStatus,
      });

      await controller.createSubscriptionFromPayment(
        { id: 7, email: 'u@example.com', role: 'user' },
        'custom-key-123',
        { paymentIntentId: mockPaymentIntentId },
      );

      expect(
        mocks.checkout.createSubscriptionFromPayment,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'custom-key-123',
        }),
      );
    });

    it('forwards the given paymentIntentId', async () => {
      mocks.checkout.createSubscriptionFromPayment.mockResolvedValueOnce({
        subscriptionId: mockSubscriptionId,
        status: mockStatus,
      });

      await controller.createSubscriptionFromPayment(
        { id: 7, email: 'u@example.com', role: 'user' },
        'idemp-pi-check',
        { paymentIntentId: 'pi_custom_abc' },
      );

      expect(
        mocks.checkout.createSubscriptionFromPayment,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'pi_custom_abc',
        }),
      );
    });

    it('passes the authenticated user id to the service', async () => {
      mocks.checkout.createSubscriptionFromPayment.mockResolvedValueOnce({
        subscriptionId: mockSubscriptionId,
        status: mockStatus,
      });

      await controller.createSubscriptionFromPayment(
        { id: 42, email: 'a@b.com', role: 'admin' },
        'idemp-user',
        { paymentIntentId: mockPaymentIntentId },
      );

      expect(
        mocks.checkout.createSubscriptionFromPayment,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
        }),
      );
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
