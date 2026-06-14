import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import {
  UserSubscription,
  SubscriptionStatus,
} from './user-subscription.entity';
import { User } from '../user/schema/user.entity';
import { Price } from '../subscriptions/entities/price.entity';
import { Plan } from '../subscriptions/entities/plan.entity';
import type { StripeInstance } from '../config/stripe.config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStripeMock(): Record<string, unknown> {
  return {
    customers: {
      create: jest.fn().mockResolvedValue({
        id: 'cus_new_123',
        email: 'test@example.com',
      }),
    },
    subscriptions: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    },
    invoices: {
      list: jest.fn(),
      finalizeInvoice: jest.fn(),
    },
  };
}

function makeRepoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    stripeCustomerId: null,
    role: 'user' as any,
    status: 'active' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    isEmailVerified: true,
    ...overrides,
  } as User;
}

function makePrice(overrides: Partial<Price> = {}): Price {
  return {
    id: 'price-uuid-1',
    planId: 'plan-uuid-1',
    currency: 'usd',
    unitAmount: 999,
    type: 'recurring' as any,
    interval: 'month' as any,
    trialPeriodDays: 7,
    active: true,
    stripePriceId: 'price_stripe_123',
    stripeProductId: null,
    plan: {
      id: 'plan-uuid-1',
      code: 'pro',
      name: 'Pro',
      description: null,
      status: 'active' as any,
      features: [],
      displayOrder: 1,
      icon: null,
      highlight: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Plan,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Price;
}

function makeSub(
  overrides: Partial<UserSubscription> = {},
): UserSubscription {
  return {
    id: 'sub-uuid-1',
    userId: 1,
    stripeSubscriptionId: 'sub_stripe_123',
    stripeCustomerId: 'cus_123',
    status: SubscriptionStatus.ACTIVE,
    planCode: 'pro',
    stripePriceId: 'price_stripe_123',
    cancelAtPeriodEnd: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserSubscription;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingService', () => {
  let service: BillingService;
  let stripe: Record<string, unknown>;
  let subRepo: ReturnType<typeof makeRepoMock>;
  let userRepo: ReturnType<typeof makeRepoMock>;
  let priceRepo: ReturnType<typeof makeRepoMock>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    stripe = makeStripeMock();
    subRepo = makeRepoMock();
    userRepo = makeRepoMock();
    priceRepo = makeRepoMock();
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: 'STRIPE_CLIENT', useValue: stripe },
        { provide: getRepositoryToken(UserSubscription), useValue: subRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Price), useValue: priceRepo },
        { provide: ConfigService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  // ─── ensureCustomer ─────────────────────────────────────────

  describe('ensureCustomer', () => {
    it('returns existing customerId when user already has stripeCustomerId', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_existing' });

      const result = await service.ensureCustomer(user);

      expect(result).toEqual({
        customerId: 'cus_existing',
        email: 'test@example.com',
      });
      expect(stripe.customers.create).not.toHaveBeenCalled();
    });

    it('creates Stripe customer and updates user when stripeCustomerId is null', async () => {
      const user = makeUser({ stripeCustomerId: null });
      userRepo.update = jest.fn().mockResolvedValue({});

      const result = await service.ensureCustomer(user);

      expect(result).toEqual({
        customerId: 'cus_new_123',
        email: 'test@example.com',
      });
      expect(stripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
        metadata: { userId: '1' },
      });
      expect(userRepo.update).toHaveBeenCalledWith(1, {
        stripeCustomerId: 'cus_new_123',
      });
    });

    it('passes undefined name when user.name is null', async () => {
      const user = makeUser({ stripeCustomerId: null, name: null });
      userRepo.update = jest.fn().mockResolvedValue({});

      await service.ensureCustomer(user);

      expect(stripe.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: undefined }),
      );
    });
  });

  // ─── createCheckoutSession ──────────────────────────────────

  describe('createCheckoutSession', () => {
    const userId = 1;
    const priceId = 'price-uuid-1';

    it('creates subscription, finalizes invoice, and returns clientSecret + subscriptionId', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      const price = makePrice();

      userRepo.findOne.mockResolvedValue(user);
      priceRepo.findOne.mockResolvedValue(price);
      subRepo.findOne.mockResolvedValue(null); // no existing sub

      (stripe.subscriptions.create as jest.Mock).mockResolvedValue({
        id: 'sub_stripe_new',
        latest_invoice: { id: 'inv_123' }, // no payment_intent — draft invoice
      });

      // Mock finalizeInvoice to return the invoice with expanded payment_intent
      (stripe.invoices.finalizeInvoice as jest.Mock).mockResolvedValue({
        id: 'inv_123',
        status: 'open',
        payment_intent: {
          id: 'pi_123',
          client_secret: 'pi_secret_xyz',
        },
      });

      const result = await service.createCheckoutSession(userId, priceId);

      expect(result).toEqual({
        clientSecret: 'pi_secret_xyz',
        subscriptionId: 'sub_stripe_new',
      });
      expect(stripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_123',
          items: [{ price: 'price_stripe_123' }],
          payment_behavior: 'default_incomplete',
        }),
        expect.anything(),
      );
      expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith(
        'inv_123',
        expect.objectContaining({ expand: ['payment_intent'] }),
      );
    });

    it('passes idempotencyKey to stripe.subscriptions.create', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      const price = makePrice();
      userRepo.findOne.mockResolvedValue(user);
      priceRepo.findOne.mockResolvedValue(price);
      subRepo.findOne.mockResolvedValue(null);
      (stripe.subscriptions.create as jest.Mock).mockResolvedValue({
        id: 'sub_new',
        latest_invoice: { id: 'inv_1', payment_intent: undefined },
      });
      (stripe.invoices.finalizeInvoice as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        status: 'open',
        payment_intent: { id: 'pi_1', client_secret: 'secret_1' },
      });

      await service.createCheckoutSession(userId, priceId, 'idem-key-123');

      expect(stripe.subscriptions.create).toHaveBeenCalledWith(
        expect.anything(),
        { idempotencyKey: 'idem-key-123' },
      );
    });

    it('throws NotFoundException when price not found', async () => {
      priceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createCheckoutSession(userId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when price is inactive', async () => {
      priceRepo.findOne.mockResolvedValue(null); // findOne with active: true returns null
      await expect(
        service.createCheckoutSession(userId, priceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user not found', async () => {
      const price = makePrice();
      priceRepo.findOne.mockResolvedValue(price);
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createCheckoutSession(userId, priceId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when user already has active subscription for same plan', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      const price = makePrice();
      const existingSub = makeSub();

      userRepo.findOne.mockResolvedValue(user);
      priceRepo.findOne.mockResolvedValue(price);
      subRepo.findOne.mockResolvedValue(existingSub); // existing subscription found

      await expect(
        service.createCheckoutSession(userId, priceId),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when invoice is missing from subscription response', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      const price = makePrice();
      userRepo.findOne.mockResolvedValue(user);
      priceRepo.findOne.mockResolvedValue(price);
      subRepo.findOne.mockResolvedValue(null);
      (stripe.subscriptions.create as jest.Mock).mockResolvedValue({
        id: 'sub_new',
        latest_invoice: null,
      });

      await expect(
        service.createCheckoutSession(userId, priceId),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns subscriptionId without clientSecret when finalizeInvoice returns no payment_intent', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      const price = makePrice();
      userRepo.findOne.mockResolvedValue(user);
      priceRepo.findOne.mockResolvedValue(price);
      subRepo.findOne.mockResolvedValue(null);
      (stripe.subscriptions.create as jest.Mock).mockResolvedValue({
        id: 'sub_new',
        latest_invoice: { id: 'inv_1' },
      });
      // finalized invoice with no payment_intent (e.g., $0 invoice already paid)
      (stripe.invoices.finalizeInvoice as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        status: 'paid',
        payment_intent: undefined,
      });

      const result = await service.createCheckoutSession(userId, priceId);

      expect(result).toEqual({ subscriptionId: 'sub_new' });
    });

    it('allows checkout when planCode is null (no conflict check)', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      const price = makePrice({
        plan: { ...makePrice().plan!, code: null } as Plan,
      });
      userRepo.findOne.mockResolvedValue(user);
      priceRepo.findOne.mockResolvedValue(price);
      subRepo.findOne.mockResolvedValue(null);
      (stripe.subscriptions.create as jest.Mock).mockResolvedValue({
        id: 'sub_new',
        latest_invoice: { id: 'inv_1' },
      });
      (stripe.invoices.finalizeInvoice as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        status: 'open',
        payment_intent: { id: 'pi_1', client_secret: 'secret_1' },
      });

      const result = await service.createCheckoutSession(userId, priceId);

      expect(result.clientSecret).toBe('secret_1');
      // subRepo.findOne should not have been called (planCode is null → skipped)
    });
  });

  // ─── changePlan ─────────────────────────────────────────────

  describe('changePlan', () => {
    const userId = 1;
    const newPriceId = 'price-uuid-2';

    it('updates subscription and returns updated record', async () => {
      const current = makeSub({ planCode: 'starter' });
      const newPrice = makePrice({
        id: 'price-uuid-2',
        stripePriceId: 'price_stripe_456',
        plan: { ...makePrice().plan!, code: 'pro' } as Plan,
      });

      subRepo.findOne.mockResolvedValue(current);
      priceRepo.findOne.mockResolvedValue(newPrice);
      (stripe.subscriptions.retrieve as jest.Mock).mockResolvedValue({
        items: { data: [{ id: 'si_1', price: { id: 'price_stripe_123' } }] },
      });
      (stripe.subscriptions.update as jest.Mock).mockResolvedValue({
        status: 'active',
      });
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.changePlan(userId, newPriceId);

      expect(result.planCode).toBe('pro');
      expect(result.stripePriceId).toBe('price_stripe_456');
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_123',
        expect.objectContaining({
          items: [{ id: 'si_1', price: 'price_stripe_456' }],
          proration_behavior: 'create_prorations',
        }),
        {
          idempotencyKey: 'change-plan-sub_stripe_123-price-uuid-2',
        },
      );
    });

    it('throws NotFoundException when no active subscription', async () => {
      subRepo.findOne.mockResolvedValue(null);

      await expect(service.changePlan(userId, newPriceId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when new price not found', async () => {
      subRepo.findOne.mockResolvedValue(makeSub());
      priceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.changePlan(userId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new plan is same as current', async () => {
      const current = makeSub({ planCode: 'pro' });
      const newPrice = makePrice({
        plan: { ...makePrice().plan!, code: 'pro' } as Plan,
      });

      subRepo.findOne.mockResolvedValue(current);
      priceRepo.findOne.mockResolvedValue(newPrice);

      await expect(service.changePlan(userId, newPriceId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when subscription has no items', async () => {
      const current = makeSub();
      const newPrice = makePrice({
        plan: { ...makePrice().plan!, code: 'enterprise' } as Plan,
      });

      subRepo.findOne.mockResolvedValue(current);
      priceRepo.findOne.mockResolvedValue(newPrice);
      (stripe.subscriptions.retrieve as jest.Mock).mockResolvedValue({
        items: { data: [] },
      });

      await expect(service.changePlan(userId, newPriceId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── cancelSubscription ─────────────────────────────────────

  describe('cancelSubscription', () => {
    it('sets cancel_at_period_end and returns updated subscription', async () => {
      const sub = makeSub();
      subRepo.findOne.mockResolvedValue(sub);
      (stripe.subscriptions.update as jest.Mock).mockResolvedValue({});
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.cancelSubscription(1);

      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_123',
        { cancel_at_period_end: true },
        { idempotencyKey: 'cancel-sub_stripe_123' },
      );
    });

    it('throws NotFoundException when no active subscription', async () => {
      subRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelSubscription(1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getCurrentSubscription ─────────────────────────────────

  describe('getCurrentSubscription', () => {
    it('returns most recent subscription for ACTIVE/TRIALING/PAST_DUE', async () => {
      const sub = makeSub();
      subRepo.findOne.mockResolvedValue(sub);

      const result = await service.getCurrentSubscription(1);

      expect(result).toEqual(sub);
      expect(subRepo.findOne).toHaveBeenCalledWith({
        where: {
          userId: 1,
          status: In([
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ]),
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns null when no active subscription exists', async () => {
      subRepo.findOne.mockResolvedValue(null);

      const result = await service.getCurrentSubscription(1);

      expect(result).toBeNull();
    });
  });

  // ─── getSubscriptionHistory ─────────────────────────────────

  describe('getSubscriptionHistory', () => {
    it('returns all subscriptions ordered by createdAt DESC', async () => {
      const subs = [makeSub({ id: 'sub-1' }), makeSub({ id: 'sub-2' })];
      subRepo.find.mockResolvedValue(subs);

      const result = await service.getSubscriptionHistory(1);

      expect(result).toEqual(subs);
      expect(subRepo.find).toHaveBeenCalledWith({
        where: { userId: 1 },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns empty array when no subscriptions', async () => {
      subRepo.find.mockResolvedValue([]);

      const result = await service.getSubscriptionHistory(1);

      expect(result).toEqual([]);
    });
  });

  // ─── getPaymentHistory ──────────────────────────────────────

  describe('getPaymentHistory', () => {
    it('maps Stripe invoices to PaymentHistoryDto[]', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      userRepo.findOne.mockResolvedValue(user);
      (stripe.invoices.list as jest.Mock).mockResolvedValue({
        data: [
          {
            id: 'inv_1',
            amount_paid: 999,
            currency: 'usd',
            status: 'paid',
            description: 'Pro Plan',
            created: 1700000000,
            invoice_pdf: 'https://invoice.stripe.com/inv_1',
          },
          {
            id: 'inv_2',
            amount_paid: 1999,
            currency: 'usd',
            status: 'open',
            description: 'Enterprise Plan',
            created: 1700100000,
            invoice_pdf: null,
          },
        ],
      });

      const result = await service.getPaymentHistory(1);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'inv_1',
        amount: 999,
        currency: 'usd',
        status: 'paid',
        description: 'Pro Plan',
        created: new Date(1700000000 * 1000),
        invoicePdf: 'https://invoice.stripe.com/inv_1',
      });
      expect(result[1]!.invoicePdf).toBeNull();
    });

    it('returns empty array when user has no stripeCustomerId', async () => {
      const user = makeUser({ stripeCustomerId: null });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.getPaymentHistory(1);

      expect(result).toEqual([]);
    });

    it('returns empty array when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.getPaymentHistory(1);

      expect(result).toEqual([]);
    });

    it('handles invoices with null status by defaulting to "unknown"', async () => {
      const user = makeUser({ stripeCustomerId: 'cus_123' });
      userRepo.findOne.mockResolvedValue(user);
      (stripe.invoices.list as jest.Mock).mockResolvedValue({
        data: [
          {
            id: 'inv_3',
            amount_paid: 500,
            currency: 'eur',
            status: null,
            description: null,
            created: 1700200000,
            invoice_pdf: undefined,
          },
        ],
      });

      const result = await service.getPaymentHistory(1);

      expect(result[0]!.status).toBe('unknown');
      expect(result[0]!.description).toBeNull();
      expect(result[0]!.invoicePdf).toBeNull();
    });
  });
});
