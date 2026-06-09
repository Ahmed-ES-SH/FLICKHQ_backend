/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { BillingCheckoutService } from './billing-checkout.service';
import { BillingCatalogService } from './billing-catalog.service';
import { BillingCustomerService } from './billing-customer.service';
import { BillingStripeService } from './billing-stripe.service';
import { BillingIdempotencyService } from './billing-idempotency.service';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingPrice } from '../entities/billing-price.entity';
import { BillingPlan } from '../entities/billing-plan.entity';
import { BillingPlanStatus, BillingPriceType } from '../common/billing.enums';
import {
  BillingIdempotencyConflictError,
  BillingIdempotencyInFlightError,
} from '../common/billing.errors';

interface PaymentRepoMock {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

interface SubscriptionRepoMock {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

interface PlanRepoMock {
  findOne: jest.Mock;
}

interface CatalogMock {
  findPriceById: jest.Mock;
}

interface StripeCheckoutSessionsMock {
  create: jest.Mock;
}

interface IdempotencyMock {
  normalizeKey: jest.Mock;
  reserve: jest.Mock;
  recordSuccess: jest.Mock;
  recordFailure: jest.Mock;
  release: jest.Mock;
}

const samplePrice: BillingPrice = {
  id: '11111111-1111-1111-1111-111111111111',
  planId: 'plan-1',
  stripePriceId: 'price_stripe_one',
  stripeProductId: 'prod_stripe_one',
  currency: 'usd',
  unitAmount: 1999,
  type: BillingPriceType.ONE_TIME,
  interval: null,
  trialPeriodDays: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleRecurringPrice: BillingPrice = {
  ...samplePrice,
  id: '22222222-2222-2222-2222-222222222222',
  stripePriceId: 'price_stripe_sub',
  unitAmount: 999,
  type: BillingPriceType.RECURRING,
  interval: 'month' as never,
  trialPeriodDays: 14,
};

const samplePlan: BillingPlan = {
  id: 'plan-1',
  code: 'pro',
  name: 'Pro',
  description: null,
  status: BillingPlanStatus.ACTIVE,
  features: ['premium_reports'],
  displayOrder: 0,
  icon: null,
  highlight: false,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BillingCheckoutService', () => {
  let service: BillingCheckoutService;
  let paymentRepo: PaymentRepoMock;
  let subscriptionRepo: SubscriptionRepoMock;
  let planRepo: PlanRepoMock;
  let catalog: CatalogMock;
  let customerService: { getOrCreateForUser: jest.Mock };
  let stripeService: jest.Mocked<BillingStripeService>;
  let stripeSessions: StripeCheckoutSessionsMock;
  let idempotency: IdempotencyMock;
  let config: ConfigService;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    paymentRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as BillingPayment),
      save: jest.fn((entity) => Promise.resolve(entity as BillingPayment)),
    };
    subscriptionRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as BillingSubscription),
      save: jest.fn((entity) => Promise.resolve(entity as BillingSubscription)),
    };
    planRepo = { findOne: jest.fn() };
    catalog = { findPriceById: jest.fn() };
    customerService = { getOrCreateForUser: jest.fn() };
    stripeSessions = { create: jest.fn() };
    stripeService = {
      getClient: jest.fn(
        () => ({ checkout: { sessions: stripeSessions } }) as never,
      ),
      safeCall: jest.fn((op: () => Promise<unknown>) => op()),
    } as unknown as jest.Mocked<BillingStripeService>;
    idempotency = {
      normalizeKey: jest.fn((k: string) => k),
      reserve: jest.fn().mockResolvedValue({
        fresh: true,
        cachedResponse: null,
        retriable: false,
      }),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      get: jest.fn((key: string) => {
        if (key === 'STRIPE_SUCCESS_URL') {
          return 'https://app.example.com/billing/success';
        }
        if (key === 'STRIPE_CANCEL_URL') {
          return 'https://app.example.com/billing/cancel';
        }
        return undefined;
      }),
    } as unknown as ConfigService;
    eventEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingCheckoutService,
        { provide: getRepositoryToken(BillingPayment), useValue: paymentRepo },
        {
          provide: getRepositoryToken(BillingSubscription),
          useValue: subscriptionRepo,
        },
        { provide: getRepositoryToken(BillingPlan), useValue: planRepo },
        { provide: BillingCatalogService, useValue: catalog },
        { provide: BillingCustomerService, useValue: customerService },
        { provide: BillingStripeService, useValue: stripeService },
        { provide: BillingIdempotencyService, useValue: idempotency },
        { provide: ConfigService, useValue: config },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(BillingCheckoutService);
  });

  // ─────────────────────────────────────────────
  // One-time
  // ─────────────────────────────────────────────

  describe('createOneTimeCheckout', () => {
    it('creates a Checkout Session and persists the local payment shell', async () => {
      catalog.findPriceById.mockResolvedValueOnce(samplePrice);
      customerService.getOrCreateForUser.mockResolvedValueOnce({
        id: 'cust-1',
        userId: 7,
        stripeCustomerId: 'cus_stripe_1',
        email: 'u@example.com',
        name: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      stripeSessions.create.mockResolvedValueOnce({
        id: 'cs_test_one',
        url: 'https://checkout.stripe.com/c/pay/cs_test_one',
      });

      const result = await service.createOneTimeCheckout({
        userId: 7,
        priceId: samplePrice.id,
        quantity: 2,
        allowPromotionCodes: true,
        idempotencyKey: 'key-1',
      });

      expect(result).toEqual({
        sessionId: 'cs_test_one',
        url: 'https://checkout.stripe.com/c/pay/cs_test_one',
      });
      expect(stripeSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          customer: 'cus_stripe_1',
          line_items: [{ price: 'price_stripe_one', quantity: 2 }],
          success_url: expect.stringContaining('CHECKOUT_SESSION_ID'),
          cancel_url: 'https://app.example.com/billing/cancel',
          allow_promotion_codes: true,
          metadata: expect.objectContaining({
            localPriceId: samplePrice.id,
            userId: '7',
          }),
        }),
      );
      // payment_method_types is NEVER set.
      const call = stripeSessions.create.mock.calls[0][0];
      expect(call).not.toHaveProperty('payment_method_types');

      expect(idempotency.recordSuccess).toHaveBeenCalledWith(
        'key-1',
        expect.objectContaining({ sessionId: 'cs_test_one' }),
      );
      expect(paymentRepo.save).toHaveBeenCalled();
      const saved = paymentRepo.save.mock.calls
        .map((c) => c[0])
        .find((p) => p.stripeCheckoutSessionId === 'cs_test_one');
      expect(saved).toMatchObject({
        userId: 7,
        amount: 1999 * 2,
        currency: 'usd',
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'billing.checkout.created',
        expect.objectContaining({ kind: 'one_time' }),
      );
    });

    it('rejects an inactive price with BillingPriceNotActiveError', async () => {
      catalog.findPriceById.mockResolvedValueOnce({
        ...samplePrice,
        active: false,
      });
      await expect(
        service.createOneTimeCheckout({
          userId: 7,
          priceId: samplePrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects a price of the wrong type', async () => {
      catalog.findPriceById.mockResolvedValueOnce({
        ...samplePrice,
        type: BillingPriceType.RECURRING,
      });
      await expect(
        service.createOneTimeCheckout({
          userId: 7,
          priceId: samplePrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('returns the cached response on idempotent replay', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: false,
        cachedResponse: {
          sessionId: 'cs_cached',
          url: 'https://cached/x',
        },
        retriable: false,
      });
      const result = await service.createOneTimeCheckout({
        userId: 7,
        priceId: samplePrice.id,
        quantity: 1,
        allowPromotionCodes: true,
        idempotencyKey: 'k',
      });
      expect(result).toEqual({
        sessionId: 'cs_cached',
        url: 'https://cached/x',
      });
      expect(stripeSessions.create).not.toHaveBeenCalled();
    });

    it('lets idempotency errors propagate unchanged', async () => {
      idempotency.reserve.mockRejectedValueOnce(
        new BillingIdempotencyInFlightError('k'),
      );
      await expect(
        service.createOneTimeCheckout({
          userId: 7,
          priceId: samplePrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toBeInstanceOf(BillingIdempotencyInFlightError);

      idempotency.reserve.mockRejectedValueOnce(
        new BillingIdempotencyConflictError('k'),
      );
      await expect(
        service.createOneTimeCheckout({
          userId: 7,
          priceId: samplePrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);
    });
  });

  // ─────────────────────────────────────────────
  // Subscription
  // ─────────────────────────────────────────────

  describe('createSubscriptionCheckout', () => {
    it('creates a subscription Checkout Session and persists payment + subscription shells', async () => {
      catalog.findPriceById.mockResolvedValueOnce(sampleRecurringPrice);
      planRepo.findOne.mockResolvedValueOnce(samplePlan);
      subscriptionRepo.findOne.mockResolvedValueOnce(null); // no active sub
      customerService.getOrCreateForUser.mockResolvedValueOnce({
        id: 'cust-1',
        userId: 7,
        stripeCustomerId: 'cus_stripe_1',
        email: 'u@example.com',
        name: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      stripeSessions.create.mockResolvedValueOnce({
        id: 'cs_test_sub',
        url: 'https://checkout.stripe.com/c/pay/cs_test_sub',
      });

      const result = await service.createSubscriptionCheckout({
        userId: 7,
        priceId: sampleRecurringPrice.id,
        quantity: 1,
        clientReferenceId: 'order-1',
        trialDays: 14,
        allowPromotionCodes: true,
        idempotencyKey: 'key-2',
      });

      expect(result).toEqual({
        sessionId: 'cs_test_sub',
        url: 'https://checkout.stripe.com/c/pay/cs_test_sub',
      });
      const sessionParams = stripeSessions.create.mock.calls[0][0];
      expect(sessionParams).toMatchObject({
        mode: 'subscription',
        customer: 'cus_stripe_1',
        line_items: [{ price: 'price_stripe_sub', quantity: 1 }],
        client_reference_id: 'order-1',
        subscription_data: {
          trial_period_days: 14,
          metadata: expect.objectContaining({
            localPriceId: sampleRecurringPrice.id,
            userId: '7',
          }),
        },
        metadata: expect.objectContaining({
          localPriceId: sampleRecurringPrice.id,
          userId: '7',
        }),
      });
      expect(sessionParams).not.toHaveProperty('payment_method_types');

      // Two local shells: payment + subscription
      const paymentCalls = paymentRepo.save.mock.calls.map((c) => c[0]);
      const subscriptionCalls = subscriptionRepo.save.mock.calls.map(
        (c) => c[0],
      );
      const lastPayment = paymentCalls[paymentCalls.length - 1];
      const lastSubscription = subscriptionCalls[subscriptionCalls.length - 1];
      expect(lastPayment).toMatchObject({
        amount: 999,
        currency: 'usd',
        status: 'checkout_created',
        stripeCheckoutSessionId: 'cs_test_sub',
        metadata: expect.objectContaining({
          kind: 'subscription',
          clientReferenceId: 'order-1',
          trialDays: 14,
        }),
      });
      expect(lastSubscription).toMatchObject({
        planId: samplePlan.id,
        priceId: sampleRecurringPrice.id,
        status: 'incomplete',
        stripeCheckoutSessionId: 'cs_test_sub',
        metadata: expect.objectContaining({
          clientReferenceId: 'order-1',
        }),
      });
      expect(lastSubscription.stripeSubscriptionId).toMatch(/^pending_sub:/);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'billing.checkout.created',
        expect.objectContaining({ kind: 'subscription' }),
      );
    });

    it('rejects an archived plan', async () => {
      catalog.findPriceById.mockResolvedValueOnce(sampleRecurringPrice);
      planRepo.findOne.mockResolvedValueOnce({
        ...samplePlan,
        status: BillingPlanStatus.ARCHIVED,
      });
      await expect(
        service.createSubscriptionCheckout({
          userId: 7,
          priceId: sampleRecurringPrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects a one-time price', async () => {
      catalog.findPriceById.mockResolvedValueOnce({
        ...samplePrice,
        type: BillingPriceType.ONE_TIME,
      });
      planRepo.findOne.mockResolvedValueOnce(samplePlan);
      await expect(
        service.createSubscriptionCheckout({
          userId: 7,
          priceId: samplePrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects a user that already has an active subscription', async () => {
      catalog.findPriceById.mockResolvedValueOnce(sampleRecurringPrice);
      planRepo.findOne.mockResolvedValueOnce(samplePlan);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'existing-sub',
        userId: 7,
        status: 'active',
        stripeSubscriptionId: 'sub_existing',
      });
      await expect(
        service.createSubscriptionCheckout({
          userId: 7,
          priceId: sampleRecurringPrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ status: 409, message: /active subscription/ });
    });

    it('marks the local subscription shell as expired when the Stripe call fails', async () => {
      catalog.findPriceById.mockResolvedValueOnce(sampleRecurringPrice);
      planRepo.findOne.mockResolvedValueOnce(samplePlan);
      subscriptionRepo.findOne.mockResolvedValueOnce(null);
      customerService.getOrCreateForUser.mockResolvedValueOnce({
        id: 'cust-1',
        userId: 7,
        stripeCustomerId: 'cus_stripe_1',
        email: 'u@example.com',
        name: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      stripeSessions.create.mockRejectedValueOnce(new Error('stripe boom'));

      await expect(
        service.createSubscriptionCheckout({
          userId: 7,
          priceId: sampleRecurringPrice.id,
          quantity: 1,
          allowPromotionCodes: true,
          idempotencyKey: 'key-fail',
        }),
      ).rejects.toThrow(/stripe boom/);

      const subscriptionCalls = subscriptionRepo.save.mock.calls.map(
        (c) => c[0],
      );
      const lastSubscription = subscriptionCalls[subscriptionCalls.length - 1];
      expect(lastSubscription.status).toBe('incomplete_expired');
      expect(idempotency.recordFailure).toHaveBeenCalledWith('key-fail');
    });
  });

  describe('placeholder subscription id helpers', () => {
    it('round-trips placeholder id detection', () => {
      const placeholder = service.buildSubscriptionPlaceholderId('pay-1');
      expect(service.isPlaceholderSubscriptionId(placeholder)).toBe(true);
      expect(service.isPlaceholderSubscriptionId('sub_real_123')).toBe(false);
    });
  });
});
