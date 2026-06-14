import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import {
  UserSubscription,
  SubscriptionStatus,
} from './user-subscription.entity';
import { User } from '../user/schema/user.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
}

function makeStripeMock() {
  return {
    webhooks: {
      constructEvent: jest.fn(),
    },
  };
}

function makeStripeSubEvent(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_stripe_123',
        customer: 'cus_123',
        status: 'active',
        metadata: { userId: '1', planCode: 'pro' },
        cancel_at_period_end: false,
        items: {
          data: [
            { id: 'si_1', price: { id: 'price_stripe_123', unit_amount: 999 } },
          ],
        },
        ...overrides,
      },
    },
  };
}

function makeStripeInvoiceEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_2',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'inv_1',
        customer: 'cus_123',
        subscription: 'sub_stripe_123',
        status: 'paid',
        amount_paid: 999,
        metadata: {},
        ...overrides,
      },
    },
  };
}

function makeStripeInvoiceFailedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_3',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'inv_2',
        customer: 'cus_123',
        subscription: 'sub_stripe_123',
        status: 'open',
        amount_paid: 999,
        metadata: {},
        ...overrides,
      },
    },
  };
}

function makeSub(overrides: Record<string, unknown> = {}): UserSubscription {
  return {
    id: 'sub-uuid-1',
    userId: 1,
    stripeSubscriptionId: 'sub_stripe_123',
    stripeCustomerId: 'cus_123',
    status: SubscriptionStatus.INCOMPLETE,
    planCode: 'free',
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

describe('WebhookController', () => {
  let controller: WebhookController;
  let stripe: ReturnType<typeof makeStripeMock>;
  let subRepo: ReturnType<typeof makeRepoMock>;
  let userRepo: ReturnType<typeof makeRepoMock>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    stripe = makeStripeMock();
    subRepo = makeRepoMock();
    userRepo = makeRepoMock();
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: 'STRIPE_CLIENT', useValue: stripe },
        { provide: getRepositoryToken(UserSubscription), useValue: subRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ConfigService, useValue: { getOrThrow: () => 'whsec_test' } },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    controller = module.get(WebhookController);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── handleWebhook ──────────────────────────────────────

  describe('handleWebhook', () => {
    it('throws BadRequestException when stripe-signature header is missing', async () => {
      await expect(
        controller.handleWebhook(
          { rawBody: Buffer.from('{}') } as any,
          undefined as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when signature verification fails', async () => {
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      await expect(
        controller.handleWebhook(
          { rawBody: Buffer.from('{}') } as any,
          'invalid_sig',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns { received: true } on success', async () => {
      const event = makeStripeSubEvent({ status: 'active' });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
      });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(result).toEqual({ received: true });
    });

    it('returns { received: true } even when processing throws (does not propagate)', async () => {
      const event = { id: 'evt_err', type: 'unknown.event', data: { object: {} } };
      stripe.webhooks.constructEvent.mockReturnValue(event);

      // Should not throw — errors are caught internally
      const result = await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(result).toEqual({ received: true });
    });
  });

  // ─── customer.subscription.updated ──────────────────────

  describe('customer.subscription.updated', () => {
    it('creates new UserSubscription when none exists locally', async () => {
      const event = makeStripeSubEvent({ status: 'active' });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null); // no existing sub
      userRepo.findOne.mockResolvedValue({ id: 1, email: 'a@b.com' });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          stripeSubscriptionId: 'sub_stripe_123',
          status: SubscriptionStatus.ACTIVE,
          planCode: 'pro',
        }),
      );
      expect(subRepo.save).toHaveBeenCalled();
    });

    it('updates existing UserSubscription status and cancelAtPeriodEnd', async () => {
      const existing = makeSub({ status: SubscriptionStatus.INCOMPLETE });
      const event = makeStripeSubEvent({
        status: 'active',
        cancel_at_period_end: true,
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(existing);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(existing.status).toBe(SubscriptionStatus.ACTIVE);
      expect(existing.cancelAtPeriodEnd).toBe(true);
      expect(subRepo.save).toHaveBeenCalledWith(existing);
    });

    it('preserves existing planCode when metadata.planCode is empty', async () => {
      const existing = makeSub({ planCode: 'enterprise' });
      const event = makeStripeSubEvent({
        status: 'active',
        metadata: { userId: '1' }, // no planCode in metadata
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(existing);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(existing.planCode).toBe('enterprise');
    });

    it('emits PAYMENT_SUCCESS when status transitions to ACTIVE', async () => {
      const event = makeStripeSubEvent({ status: 'active' });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 1, email: 'a@b.com' });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'notification.payment.success',
        expect.objectContaining({
          userId: '1',
          title: 'Subscription Updated',
        }),
      );
    });

    it('does not emit notification when status is not ACTIVE', async () => {
      const event = makeStripeSubEvent({ status: 'past_due' });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 1, email: 'a@b.com' });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('skips processing when userId is missing from metadata', async () => {
      const event = makeStripeSubEvent({
        metadata: {}, // no userId
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.findOne).not.toHaveBeenCalled();
    });

    it('skips when user not found in DB', async () => {
      const event = makeStripeSubEvent({ status: 'active' });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(null);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.create).not.toHaveBeenCalled();
    });

    it('handles customer object as { id: string } instead of string', async () => {
      const event = makeStripeSubEvent({
        customer: { id: 'cus_nested' },
        status: 'active',
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 1, email: 'a@b.com' });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ stripeCustomerId: 'cus_nested' }),
      );
    });
  });

  // ─── customer.subscription.created ──────────────────────

  describe('customer.subscription.created', () => {
    it('creates subscription record (same path as updated)', async () => {
      const event = {
        ...makeStripeSubEvent({ status: 'active' }),
        type: 'customer.subscription.created',
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 1, email: 'a@b.com' });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.save).toHaveBeenCalled();
    });
  });

  // ─── customer.subscription.deleted ──────────────────────

  describe('customer.subscription.deleted', () => {
    it('sets status to CANCELED and emits PAYMENT_FAILED', async () => {
      const existing = makeSub({ status: SubscriptionStatus.ACTIVE });
      const event = {
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_stripe_123',
            customer: 'cus_123',
            status: 'canceled',
            metadata: {},
            cancel_at_period_end: false,
            items: { data: [] },
          },
        },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(existing);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(existing.status).toBe(SubscriptionStatus.CANCELED);
      expect(existing.cancelAtPeriodEnd).toBe(false);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'notification.payment.failed',
        expect.objectContaining({
          title: 'Subscription Ended',
        }),
      );
    });

    it('does nothing when subscription not found locally', async () => {
      const event = {
        id: 'evt_del2',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_nonexistent',
            customer: 'cus_123',
            status: 'canceled',
            metadata: {},
            cancel_at_period_end: false,
            items: { data: [] },
          },
        },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── invoice.paid ───────────────────────────────────────

  describe('invoice.paid', () => {
    it('sets subscription status to ACTIVE and emits PAYMENT_SUCCESS', async () => {
      const existing = makeSub({ status: SubscriptionStatus.INCOMPLETE });
      const event = makeStripeInvoiceEvent();
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(existing);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(existing.status).toBe(SubscriptionStatus.ACTIVE);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'notification.payment.success',
        expect.objectContaining({
          userId: '1',
          paymentId: 'inv_1',
          amount: 999,
          title: 'Payment Received',
        }),
      );
    });

    it('skips when subscription not found locally', async () => {
      const event = makeStripeInvoiceEvent({
        subscription: 'sub_unknown',
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.save).not.toHaveBeenCalled();
    });

    it('skips when invoice has no subscription', async () => {
      const event = makeStripeInvoiceEvent({ subscription: null });
      stripe.webhooks.constructEvent.mockReturnValue(event);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.findOne).not.toHaveBeenCalled();
    });

    it('resolves subscription id from object { id: string }', async () => {
      const existing = makeSub({ status: SubscriptionStatus.INCOMPLETE });
      const event = makeStripeInvoiceEvent({
        subscription: { id: 'sub_stripe_123' },
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(existing);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(existing.status).toBe(SubscriptionStatus.ACTIVE);
    });
  });

  // ─── invoice.payment_failed ─────────────────────────────

  describe('invoice.payment_failed', () => {
    it('sets subscription status to PAST_DUE and emits PAYMENT_FAILED', async () => {
      const existing = makeSub({ status: SubscriptionStatus.ACTIVE });
      const event = makeStripeInvoiceFailedEvent();
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(existing);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(existing.status).toBe(SubscriptionStatus.PAST_DUE);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'notification.payment.failed',
        expect.objectContaining({
          userId: '1',
          paymentId: 'inv_2',
          title: 'Payment Failed',
        }),
      );
    });

    it('skips when subscription not found locally', async () => {
      const event = makeStripeInvoiceFailedEvent({
        subscription: 'sub_unknown',
      });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.save).not.toHaveBeenCalled();
    });

    it('skips when invoice has no subscription', async () => {
      const event = makeStripeInvoiceFailedEvent({ subscription: null });
      stripe.webhooks.constructEvent.mockReturnValue(event);

      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(subRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ─── deduplication ──────────────────────────────────────

  describe('event deduplication', () => {
    it('skips duplicate events', async () => {
      const event = makeStripeSubEvent({ status: 'active' });
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ id: 1, email: 'a@b.com' });
      subRepo.create.mockImplementation((s) => s);
      subRepo.save.mockImplementation((s) => Promise.resolve(s));

      // First call — processes normally
      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );
      expect(subRepo.save).toHaveBeenCalledTimes(1);

      // Second call with same event.id — should skip
      await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );
      // save still called only once (dedup skipped second)
      expect(subRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ─── unhandled events ───────────────────────────────────

  describe('unhandled event types', () => {
    it('does not throw on unknown event types', async () => {
      const event = { id: 'evt_unknown', type: 'charge.succeeded', data: { object: {} } };
      stripe.webhooks.constructEvent.mockReturnValue(event);

      const result = await controller.handleWebhook(
        { rawBody: Buffer.from('{}') } as any,
        'valid_sig',
      );

      expect(result).toEqual({ received: true });
    });
  });
});
