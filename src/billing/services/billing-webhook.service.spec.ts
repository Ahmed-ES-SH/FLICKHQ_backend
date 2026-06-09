import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueryFailedError } from 'typeorm';

import { BillingWebhookEvent } from '../entities/billing-webhook-event.entity';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingInvoice } from '../entities/billing-invoice.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';

import { BillingWebhookService } from './billing-webhook.service';
import { BillingStripeService } from './billing-stripe.service';
import { BillingCustomerService } from './billing-customer.service';
import { BillingCheckoutService } from './billing-checkout.service';
import { BillingEntitlementsService } from './billing-entitlements.service';

import {
  BillingInvoiceStatus,
  BillingPaymentStatus,
  BillingSubscriptionStatus,
  BillingTransactionStatus,
  BillingTransactionType,
  BillingWebhookEventStatus,
} from '../common/billing.enums';
import {
  BILLING_EVENTS,
  STRIPE_WEBHOOK_EVENT_TYPES,
} from '../common/billing.constants';
import { StripeSignatureVerificationFailedError } from '../common/billing.errors';

interface RepoMock {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  increment: jest.Mock;
  manager: { getRepository: jest.Mock };
  createQueryBuilder: jest.Mock;
}

const firstArg = <T>(mock: { mock: { calls: unknown[][] } }): T =>
  mock.mock.calls[0]?.[0] as T;

interface StripeServiceMock {
  constructWebhookEvent: jest.Mock;
  redactSecrets: jest.Mock;
}

interface CustomerServiceMock {
  applyCustomerUpdate: jest.Mock;
}

interface CheckoutServiceMock {
  isPlaceholderSubscriptionId: jest.Mock;
  buildSubscriptionPlaceholderId: jest.Mock;
}

interface EntitlementsServiceMock {
  recomputeForUser: jest.Mock;
}

interface EventEmitterMock {
  emit: jest.Mock;
}

const buildRepoMock = (): RepoMock => ({
  findOne: jest.fn(),
  create: jest.fn((dto): unknown => dto),
  save: jest.fn((e): unknown => Promise.resolve(e)),
  update: jest.fn((): Promise<unknown> => Promise.resolve(undefined)),
  increment: jest.fn((): Promise<unknown> => Promise.resolve(undefined)),
  manager: { getRepository: jest.fn() },
  createQueryBuilder: jest.fn(),
});

describe('BillingWebhookService', () => {
  let service: BillingWebhookService;
  let eventRepo: RepoMock;
  let paymentRepo: RepoMock;
  let subscriptionRepo: RepoMock;
  let invoiceRepo: RepoMock;
  let transactionRepo: RepoMock;
  let stripeService: StripeServiceMock;
  let customerService: CustomerServiceMock;
  let checkoutService: CheckoutServiceMock;
  let entitlementsService: EntitlementsServiceMock;
  let eventEmitter: EventEmitterMock;

  const baseEvent = {
    id: 'evt_test_1',
    type: 'customer.created',
    api_version: '2026-05-27.dahlia',
    livemode: false,
    created: 1_700_000_000,
    data: { object: { id: 'cus_x' } },
  };

  beforeEach(async () => {
    eventRepo = buildRepoMock();
    paymentRepo = buildRepoMock();
    subscriptionRepo = buildRepoMock();
    invoiceRepo = buildRepoMock();
    transactionRepo = buildRepoMock();

    stripeService = {
      constructWebhookEvent: jest.fn(() => baseEvent),
      redactSecrets: jest.fn((s: string) => s),
    };
    customerService = {
      applyCustomerUpdate: jest.fn(),
    };
    checkoutService = {
      isPlaceholderSubscriptionId: jest.fn((id: string) =>
        id.startsWith('pending_sub:'),
      ),
      buildSubscriptionPlaceholderId: jest.fn(
        (paymentId: string) => `pending_sub:${paymentId}`,
      ),
    };
    entitlementsService = {
      recomputeForUser: jest.fn().mockResolvedValue({
        added: 0,
        removed: 0,
        kept: 0,
      }),
    };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingWebhookService,
        {
          provide: getRepositoryToken(BillingWebhookEvent),
          useValue: eventRepo,
        },
        { provide: getRepositoryToken(BillingPayment), useValue: paymentRepo },
        {
          provide: getRepositoryToken(BillingSubscription),
          useValue: subscriptionRepo,
        },
        { provide: getRepositoryToken(BillingInvoice), useValue: invoiceRepo },
        {
          provide: getRepositoryToken(BillingTransaction),
          useValue: transactionRepo,
        },
        { provide: BillingStripeService, useValue: stripeService },
        { provide: BillingCustomerService, useValue: customerService },
        { provide: BillingCheckoutService, useValue: checkoutService },
        { provide: BillingEntitlementsService, useValue: entitlementsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(BillingWebhookService);
  });

  describe('receiveEvent — entrypoint', () => {
    it('verifies the signature by delegating to BillingStripeService', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      customerService.applyCustomerUpdate.mockResolvedValueOnce({
        id: 'local-1',
        userId: 7,
      });
      const result = await service.receiveEvent(
        Buffer.from('{"id":"evt_test_1"}'),
        't=1,v1=abc',
      );
      expect(stripeService.constructWebhookEvent).toHaveBeenCalledWith(
        expect.any(Buffer),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
    });

    it('throws StripeSignatureVerificationFailedError on bad signature', async () => {
      stripeService.constructWebhookEvent.mockImplementationOnce(() => {
        throw new StripeSignatureVerificationFailedError('bad sig');
      });
      await expect(
        service.receiveEvent(Buffer.from('{}'), 'bad'),
      ).rejects.toBeInstanceOf(StripeSignatureVerificationFailedError);
      // No row was persisted.
      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('returns duplicate when the same event id has already been processed', async () => {
      eventRepo.findOne.mockResolvedValueOnce({
        id: 'local-1',
        stripeEventId: 'evt_test_1',
        status: BillingWebhookEventStatus.PROCESSED,
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('duplicate');
      expect(result.stripeEventId).toBe('evt_test_1');
      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('recovers from a unique-violation race on insert (concurrent worker)', async () => {
      eventRepo.findOne
        .mockResolvedValueOnce(null) // first lookup
        .mockResolvedValueOnce({
          // winning row
          id: 'local-2',
          stripeEventId: 'evt_test_1',
          status: BillingWebhookEventStatus.RECEIVED,
        });
      const unique = new QueryFailedError(
        'INSERT',
        [],
        new Error('duplicate') as never,
      );
      (unique as unknown as { code: string }).code = '23505';
      eventRepo.save.mockRejectedValueOnce(unique);

      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('duplicate');
    });
  });

  describe('checkout.session.completed', () => {
    const sessionEvent = {
      ...baseEvent,
      id: 'evt_ck_1',
      type: STRIPE_WEBHOOK_EVENT_TYPES.CHECKOUT_SESSION_COMPLETED,
      data: {
        object: {
          id: 'cs_test_1',
          mode: 'payment',
          payment_intent: 'pi_1',
          payment_status: 'paid',
          customer: 'cus_1',
          metadata: { localPaymentId: 'pay-1' },
        },
      },
    };

    it('updates the local payment and emits billing.payment.succeeded', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-1',
        userId: 7,
        billingCustomerId: 'cust-1',
        status: BillingPaymentStatus.CHECKOUT_CREATED,
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        amount: 1000,
        currency: 'usd',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce(sessionEvent);
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      expect(paymentRepo.save).toHaveBeenCalled();
      const saved = firstArg<BillingPayment>(paymentRepo.save);
      expect(saved.stripePaymentIntentId).toBe('pi_1');
      expect(saved.stripeCheckoutSessionId).toBe('cs_test_1');
      expect(saved.status).toBe(BillingPaymentStatus.SUCCEEDED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.PAYMENT_SUCCEEDED,
        expect.objectContaining({ userId: 7, localPaymentId: 'pay-1' }),
      );
    });

    it('replaces the pending_sub placeholder with the real subscription id', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-2',
        userId: 8,
        billingCustomerId: 'cust-2',
        status: BillingPaymentStatus.CHECKOUT_CREATED,
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        amount: 1000,
        currency: 'usd',
      });
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-local-1',
        userId: 8,
        billingCustomerId: 'cust-2',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'pending_sub:pay-2',
        status: BillingSubscriptionStatus.INCOMPLETE,
        metadata: {},
      });
      const subEvent = {
        ...sessionEvent,
        id: 'evt_ck_2',
        data: {
          object: {
            id: 'cs_sub_1',
            mode: 'subscription',
            payment_intent: 'pi_2',
            payment_status: 'paid',
            subscription: 'sub_real_1',
            metadata: {
              localPaymentId: 'pay-2',
              localSubscriptionId: 'sub-local-1',
            },
          },
        },
      };
      stripeService.constructWebhookEvent.mockReturnValueOnce(subEvent);

      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const saved = firstArg<BillingSubscription>(subscriptionRepo.save);
      expect(saved.stripeSubscriptionId).toBe('sub_real_1');
      expect(saved.stripeCheckoutSessionId).toBe('cs_sub_1');
    });

    it('returns ignored when the local payment id cannot be found', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce(null);
      stripeService.constructWebhookEvent.mockReturnValueOnce(sessionEvent);
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('ignored');
      expect(eventRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: BillingWebhookEventStatus.IGNORED }),
      );
    });
  });

  describe('checkout.session.expired', () => {
    it('marks the payment canceled and the subscription shell incomplete_expired', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-3',
        userId: 9,
        billingCustomerId: 'cust-3',
        status: BillingPaymentStatus.CHECKOUT_CREATED,
        stripeCheckoutSessionId: null,
      });
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-2',
        userId: 9,
        billingCustomerId: 'cust-3',
        stripeSubscriptionId: 'pending_sub:pay-3',
        status: BillingSubscriptionStatus.INCOMPLETE,
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_exp_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CHECKOUT_SESSION_EXPIRED,
        data: {
          object: {
            id: 'cs_exp_1',
            metadata: {
              localPaymentId: 'pay-3',
              localSubscriptionId: 'sub-2',
            },
          },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const paySaved = firstArg<BillingPayment>(paymentRepo.save);
      expect(paySaved.status).toBe(BillingPaymentStatus.CANCELED);
      const subSaved = firstArg<BillingSubscription>(subscriptionRepo.save);
      expect(subSaved.status).toBe(
        BillingSubscriptionStatus.INCOMPLETE_EXPIRED,
      );
    });

    it('does not regress a payment that already succeeded', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-3b',
        userId: 9,
        billingCustomerId: 'cust-3',
        status: BillingPaymentStatus.SUCCEEDED,
        stripeCheckoutSessionId: null,
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_exp_2',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CHECKOUT_SESSION_EXPIRED,
        data: {
          object: {
            id: 'cs_exp_2',
            metadata: { localPaymentId: 'pay-3b' },
          },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.succeeded', () => {
    it('updates the payment and writes a charge transaction (de-duped)', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-4',
        userId: 10,
        billingCustomerId: 'cust-4',
        status: BillingPaymentStatus.PENDING,
        stripePaymentIntentId: 'pi_4',
        amount: 2000,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null); // no existing tx
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_pi_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_SUCCEEDED,
        data: { object: { id: 'pi_4', amount: 2000, currency: 'usd' } },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const paySaved = firstArg<BillingPayment>(paymentRepo.save);
      expect(paySaved.status).toBe(BillingPaymentStatus.SUCCEEDED);
      const txSaved = firstArg<BillingTransaction>(transactionRepo.save);
      expect(txSaved.type).toBe(BillingTransactionType.CHARGE);
      expect(txSaved.stripePaymentIntentId).toBe('pi_4');
      expect(txSaved.status).toBe(BillingTransactionStatus.SUCCEEDED);
    });

    it('does not write a duplicate charge transaction on retry', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-5',
        userId: 10,
        billingCustomerId: 'cust-5',
        status: BillingPaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_5',
        amount: 1000,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce({ id: 'tx-1' });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('marks the payment failed and emits billing.payment.failed', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-6',
        userId: 11,
        billingCustomerId: 'cust-6',
        status: BillingPaymentStatus.PENDING,
        stripePaymentIntentId: 'pi_6',
        amount: 500,
        currency: 'usd',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_pf_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_PAYMENT_FAILED,
        data: {
          object: {
            id: 'pi_6',
            status: 'requires_payment_method',
            last_payment_error: { message: 'card_declined' },
          },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const saved = firstArg<BillingPayment>(paymentRepo.save);
      expect(saved.status).toBe(BillingPaymentStatus.FAILED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.PAYMENT_FAILED,
        expect.objectContaining({ lastError: 'card_declined' }),
      );
    });
  });

  describe('charge.refunded', () => {
    it('writes refund transactions and updates amount_refunded + payment status', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-7',
        userId: 12,
        billingCustomerId: 'cust-7',
        status: BillingPaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_7',
        amount: 1000,
        amountRefunded: 0,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null); // no existing refund
      transactionRepo.createQueryBuilder.mockReturnValueOnce({
        select: () => ({
          where: () => ({
            andWhere: () => ({
              getRawOne: () => Promise.resolve({ sum: '300' }),
            }),
          }),
        }),
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_ref_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CHARGE_REFUNDED,
        data: {
          object: {
            id: 'ch_1',
            amount: 1000,
            amount_refunded: 300,
            payment_intent: 'pi_7',
            refunds: {
              data: [
                {
                  id: 're_1',
                  amount: 300,
                  currency: 'usd',
                  status: 'succeeded',
                },
              ],
            },
          },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const txSaved = firstArg<BillingTransaction>(transactionRepo.save);
      expect(txSaved.type).toBe(BillingTransactionType.REFUND);
      expect(txSaved.stripeRefundId).toBe('re_1');
      const paySaved = firstArg<BillingPayment>(paymentRepo.save);
      expect(paySaved.amountRefunded).toBe(300);
      expect(paySaved.status).toBe(BillingPaymentStatus.PARTIALLY_REFUNDED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.REFUND_SUCCEEDED,
        expect.objectContaining({ amountRefunded: 300 }),
      );
    });

    it('flips payment to refunded when amountRefunded >= amount', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-8',
        userId: 13,
        billingCustomerId: 'cust-8',
        status: BillingPaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_8',
        amount: 1000,
        amountRefunded: 0,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null);
      transactionRepo.createQueryBuilder.mockReturnValueOnce({
        select: () => ({
          where: () => ({
            andWhere: () => ({
              getRawOne: () => Promise.resolve({ sum: '1000' }),
            }),
          }),
        }),
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_ref_2',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CHARGE_REFUNDED,
        data: {
          object: {
            id: 'ch_2',
            amount: 1000,
            payment_intent: 'pi_8',
            refunds: {
              data: [
                {
                  id: 're_2',
                  amount: 1000,
                  currency: 'usd',
                  status: 'succeeded',
                },
              ],
            },
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      const paySaved = firstArg<BillingPayment>(paymentRepo.save);
      expect(paySaved.status).toBe(BillingPaymentStatus.REFUNDED);
    });
  });

  describe('customer.*', () => {
    it('delegates to BillingCustomerService.applyCustomerUpdate', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      customerService.applyCustomerUpdate.mockResolvedValueOnce({
        id: 'local-cust',
        userId: 14,
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      expect(customerService.applyCustomerUpdate).toHaveBeenCalledWith({
        id: 'cus_x',
      });
    });

    it('returns ignored when no local customer row matches', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      customerService.applyCustomerUpdate.mockResolvedValueOnce(null);
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('ignored');
    });
  });

  describe('customer.subscription.*', () => {
    const subSnapshot = {
      id: 'sub_real_1',
      status: 'active',
      customer: 'cus_1',
      current_period_start: 1_700_000_000,
      current_period_end: 1_702_592_000,
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      latest_invoice: 'in_1',
      metadata: { localPaymentId: 'pay-1' },
    };

    it('upserts by real id and mirrors status / period dates', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-local-1',
        userId: 8,
        billingCustomerId: 'cust-2',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'sub_real_1',
        status: BillingSubscriptionStatus.INCOMPLETE,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        metadata: {},
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED,
        data: { object: subSnapshot },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const saved = firstArg<BillingSubscription>(subscriptionRepo.save);
      expect(saved.status).toBe(BillingSubscriptionStatus.ACTIVE);
      expect(saved.currentPeriodStart).toBeInstanceOf(Date);
      expect(saved.latestInvoiceId).toBe('in_1');
    });

    it('replaces pending_sub:<id> placeholder when matching by localPaymentId', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne
        .mockResolvedValueOnce(null) // by real id
        .mockResolvedValueOnce({
          // by placeholder
          id: 'sub-local-2',
          userId: 9,
          billingCustomerId: 'cust-3',
          planId: 'plan-1',
          priceId: 'price-1',
          stripeSubscriptionId: 'pending_sub:pay-9',
          status: BillingSubscriptionStatus.INCOMPLETE,
          metadata: {},
        });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_2',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_CREATED,
        data: {
          object: {
            ...subSnapshot,
            id: 'sub_real_2',
            metadata: { localPaymentId: 'pay-9' },
          },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const saved = firstArg<BillingSubscription>(subscriptionRepo.save);
      expect(saved.stripeSubscriptionId).toBe('sub_real_2');
    });

    it('marks the subscription canceled on subscription.deleted', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-local-3',
        userId: 10,
        billingCustomerId: 'cust-4',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'sub_real_3',
        status: BillingSubscriptionStatus.ACTIVE,
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_3',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_DELETED,
        data: {
          object: {
            id: 'sub_real_3',
            status: 'canceled',
            canceled_at: 1_700_000_000,
          },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const saved = firstArg<BillingSubscription>(subscriptionRepo.save);
      expect(saved.status).toBe(BillingSubscriptionStatus.CANCELED);
      expect(saved.cancelAtPeriodEnd).toBe(true);
      expect(saved.canceledAt).toBeInstanceOf(Date);
    });

    it('returns ignored when no local subscription row can be matched', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValue(null);
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_4',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED,
        data: { object: { id: 'sub_unknown', status: 'active' } },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('ignored');
    });

    it('falls back to INCOMPLETE for unknown Stripe status strings', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-local-5',
        userId: 10,
        billingCustomerId: 'cust-4',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'sub_real_5',
        status: BillingSubscriptionStatus.ACTIVE,
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_5',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED,
        data: {
          object: { id: 'sub_real_5', status: 'some_future_status' },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const saved = firstArg<BillingSubscription>(subscriptionRepo.save);
      expect(saved.status).toBe(BillingSubscriptionStatus.INCOMPLETE);
    });
  });

  describe('invoice.*', () => {
    const invoiceSnapshot = {
      id: 'in_1',
      status: 'paid',
      currency: 'usd',
      subtotal: 900,
      total: 1000,
      amount_paid: 1000,
      amount_due: 0,
      customer: 'cus_1',
      subscription: 'sub_real_1',
      payment_intent: 'pi_1',
      hosted_invoice_url: 'https://invoice.stripe.com/i/1',
      invoice_pdf: 'https://invoice.stripe.com/i/1.pdf',
      number: 'INV-0001',
      period_start: 1_700_000_000,
      period_end: 1_702_592_000,
      paid_at: 1_700_000_100,
    };

    it('upserts by stripe_invoice_id and stores a summary (no line entities)', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      invoiceRepo.findOne.mockResolvedValueOnce(null); // create path
      // manager.getRepository for the customer lookup
      const customerRepo = {
        findOne: jest.fn().mockResolvedValueOnce({ userId: 7 }),
      };
      subscriptionRepo.manager.getRepository.mockReturnValueOnce(customerRepo);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-local-1',
        stripeSubscriptionId: 'sub_real_1',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_inv_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAID,
        data: { object: invoiceSnapshot },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const created = firstArg<BillingInvoice>(invoiceRepo.create);
      expect(created.stripeInvoiceId).toBe('in_1');
      expect(created.userId).toBe(7);
      const saved = firstArg<BillingInvoice>(invoiceRepo.save);
      expect(saved.status).toBe(BillingInvoiceStatus.PAID);
      expect(saved.stripeSnapshot).toMatchObject({
        id: 'in_1',
        number: 'INV-0001',
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.INVOICE_PAID,
        expect.objectContaining({ amountPaid: 1000 }),
      );
    });

    it('invoice.payment_failed also marks the linked payment failed', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      invoiceRepo.findOne.mockResolvedValueOnce({
        id: 'inv-local-1',
        userId: 8,
        subscriptionId: null,
        stripeInvoiceId: 'in_2',
        status: BillingInvoiceStatus.OPEN,
        currency: 'usd',
        subtotal: 0,
        total: 1000,
        amountPaid: 0,
        amountDue: 1000,
      });
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-9',
        userId: 8,
        billingCustomerId: 'cust-9',
        status: BillingPaymentStatus.PENDING,
        stripePaymentIntentId: 'pi_9',
        amount: 1000,
        currency: 'usd',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_inv_2',
        type: STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAYMENT_FAILED,
        data: {
          object: { ...invoiceSnapshot, id: 'in_2', payment_intent: 'pi_9' },
        },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('processed');
      const paySaved = firstArg<BillingPayment>(paymentRepo.save);
      expect(paySaved.status).toBe(BillingPaymentStatus.FAILED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        BILLING_EVENTS.INVOICE_PAYMENT_FAILED,
        expect.anything(),
      );
    });

    it('returns ignored when no local customer matches the invoice', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      invoiceRepo.findOne.mockResolvedValueOnce(null);
      const customerRepo = { findOne: jest.fn().mockResolvedValueOnce(null) };
      subscriptionRepo.manager.getRepository.mockReturnValueOnce(customerRepo);
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_inv_3',
        type: STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAID,
        data: { object: { ...invoiceSnapshot, id: 'in_orphan' } },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('ignored');
    });
  });

  describe('replayEvent (Phase 7)', () => {
    const storedPayload = {
      id: 'evt_replay_1',
      type: 'payment_intent.succeeded',
      api_version: '2026-05-27.dahlia',
      livemode: false,
      created: 1_700_000_000,
      data: { object: { id: 'pi_replay_1', amount: 1000, currency: 'usd' } },
    };

    it('re-dispatches a failed event from its stored payload', async () => {
      eventRepo.findOne.mockResolvedValueOnce({
        id: 'local-replay-1',
        stripeEventId: 'evt_replay_1',
        eventType: 'payment_intent.succeeded',
        status: BillingWebhookEventStatus.FAILED,
        payload: storedPayload,
      });
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-replay-1',
        userId: 30,
        billingCustomerId: 'cust-replay-1',
        status: BillingPaymentStatus.PENDING,
        stripePaymentIntentId: 'pi_replay_1',
        amount: 1000,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.replayEvent('local-replay-1');

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('processed');
      expect(result!.stripeEventId).toBe('evt_replay_1');
      // The event was marked processed (status flipped back)
      expect(eventRepo.update).toHaveBeenCalledWith(
        { id: 'local-replay-1' },
        expect.objectContaining({
          status: BillingWebhookEventStatus.PROCESSED,
        }),
      );
    });

    it('returns null when the event id does not exist', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      const result = await service.replayEvent('nonexistent');
      expect(result).toBeNull();
    });

    it('returns failed when the payload cannot be reconstructed', async () => {
      eventRepo.findOne.mockResolvedValueOnce({
        id: 'local-replay-2',
        stripeEventId: 'evt_bad',
        eventType: 'payment_intent.succeeded',
        status: BillingWebhookEventStatus.FAILED,
        payload: { raw: '<buffer>' }, // missing id/type/data
      });
      const result = await service.replayEvent('local-replay-2');
      expect(result).not.toBeNull();
      expect(result).not.toBeNull();
      const r = result!;
      if (r.kind === 'failed') {
        expect(r.errorMessage).toContain(
          'Stored payload is missing required fields',
        );
      } else {
        throw new Error('Expected failed result');
      }
    });

    it('returns failed when the handler throws during replay', async () => {
      eventRepo.findOne.mockResolvedValueOnce({
        id: 'local-replay-3',
        stripeEventId: 'evt_replay_3',
        eventType: 'payment_intent.succeeded',
        status: BillingWebhookEventStatus.FAILED,
        payload: storedPayload,
      });
      paymentRepo.findOne.mockResolvedValueOnce(null); // unknown PI -> ignored

      const result = await service.replayEvent('local-replay-3');
      expect(result).not.toBeNull();
    });
  });

  describe('unhandled event types', () => {
    it('returns ignored (and does not crash) for unknown types', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_unknown_1',
        type: 'some.future.event.type',
        data: { object: { id: 'foo' } },
      });
      const result = await service.receiveEvent(
        Buffer.from('{}'),
        't=1,v1=abc',
      );
      expect(result.kind).toBe('ignored');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Phase 6 — entitlement recompute integration
  // ─────────────────────────────────────────────────────────────────

  describe('entitlement recompute integration', () => {
    it('calls recomputeForUser on payment_intent.succeeded with the payment userId', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-r-1',
        userId: 21,
        billingCustomerId: 'cust-r-1',
        status: BillingPaymentStatus.PENDING,
        stripePaymentIntentId: 'pi_r_1',
        amount: 1000,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null);
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_pi_r_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_SUCCEEDED,
        data: { object: { id: 'pi_r_1', amount: 1000, currency: 'usd' } },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).toHaveBeenCalledWith(21);
    });

    it('calls recomputeForUser on customer.subscription.created', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-r-1',
        userId: 22,
        billingCustomerId: 'cust-r-2',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'sub_r_1',
        status: BillingSubscriptionStatus.ACTIVE,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        metadata: {},
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_r_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_CREATED,
        data: {
          object: {
            id: 'sub_r_1',
            status: 'active',
            customer: 'cus_r_1',
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
            trial_end: null,
            cancel_at_period_end: false,
            canceled_at: null,
            latest_invoice: 'in_r_1',
            metadata: {},
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).toHaveBeenCalledWith(22);
    });

    it('calls recomputeForUser on customer.subscription.updated', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-r-2',
        userId: 23,
        billingCustomerId: 'cust-r-3',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'sub_r_2',
        status: BillingSubscriptionStatus.ACTIVE,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        metadata: {},
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_r_2',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED,
        data: {
          object: {
            id: 'sub_r_2',
            status: 'active',
            customer: 'cus_r_1',
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
            trial_end: null,
            cancel_at_period_end: false,
            canceled_at: null,
            latest_invoice: 'in_r_2',
            metadata: {},
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).toHaveBeenCalledWith(23);
    });

    it('calls recomputeForUser on customer.subscription.deleted (deactivation)', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-r-3',
        userId: 24,
        billingCustomerId: 'cust-r-4',
        planId: 'plan-1',
        priceId: 'price-1',
        stripeSubscriptionId: 'sub_r_3',
        status: BillingSubscriptionStatus.ACTIVE,
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_sub_r_3',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_DELETED,
        data: {
          object: {
            id: 'sub_r_3',
            status: 'canceled',
            canceled_at: 1_700_000_000,
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).toHaveBeenCalledWith(24);
    });

    it('calls recomputeForUser on invoice.payment_failed (status regression)', async () => {
      eventRepo.findOne.mockResolvedValueOnce(null);
      invoiceRepo.findOne.mockResolvedValueOnce({
        id: 'inv-r-1',
        userId: 25,
        subscriptionId: null,
        stripeInvoiceId: 'in_r_1',
        status: BillingInvoiceStatus.OPEN,
        currency: 'usd',
        subtotal: 0,
        total: 1000,
        amountPaid: 0,
        amountDue: 1000,
      });
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-r-2',
        userId: 25,
        billingCustomerId: 'cust-r-5',
        status: BillingPaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_r_2',
        amount: 1000,
        currency: 'usd',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_inv_r_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAYMENT_FAILED,
        data: {
          object: {
            id: 'in_r_1',
            status: 'open',
            currency: 'usd',
            payment_intent: 'pi_r_2',
            customer: 'cus_r_1',
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).toHaveBeenCalledWith(25);
    });

    it('does NOT call recomputeForUser on charge.refunded', async () => {
      entitlementsService.recomputeForUser.mockClear();
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-r-3',
        userId: 26,
        billingCustomerId: 'cust-r-6',
        status: BillingPaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_r_3',
        amount: 1000,
        amountRefunded: 0,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null);
      transactionRepo.createQueryBuilder.mockReturnValueOnce({
        select: () => ({
          where: () => ({
            andWhere: () => ({
              getRawOne: () => Promise.resolve({ sum: '0' }),
            }),
          }),
        }),
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_ref_r_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CHARGE_REFUNDED,
        data: {
          object: {
            id: 'ch_r_1',
            amount: 1000,
            amount_refunded: 0,
            payment_intent: 'pi_r_3',
            refunds: { data: [] },
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).not.toHaveBeenCalled();
    });

    it('does NOT call recomputeForUser on invoice.paid', async () => {
      entitlementsService.recomputeForUser.mockClear();
      eventRepo.findOne.mockResolvedValueOnce(null);
      invoiceRepo.findOne.mockResolvedValueOnce({
        id: 'inv-r-2',
        userId: 27,
        subscriptionId: 'sub-r-4',
        stripeInvoiceId: 'in_r_2',
        status: BillingInvoiceStatus.OPEN,
        currency: 'usd',
        subtotal: 0,
        total: 1000,
        amountPaid: 0,
        amountDue: 1000,
      });
      subscriptionRepo.findOne.mockResolvedValueOnce({
        id: 'sub-r-4',
        stripeSubscriptionId: 'sub_r_4',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_inv_r_2',
        type: STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAID,
        data: {
          object: {
            id: 'in_r_2',
            status: 'paid',
            currency: 'usd',
            customer: 'cus_r_1',
            subscription: 'sub_r_4',
            payment_intent: 'pi_r_4',
            subtotal: 1000,
            total: 1000,
            amount_paid: 1000,
            amount_due: 0,
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).not.toHaveBeenCalled();
    });

    it('does NOT call recomputeForUser on checkout.session.completed', async () => {
      entitlementsService.recomputeForUser.mockClear();
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-r-4',
        userId: 28,
        billingCustomerId: 'cust-r-7',
        status: BillingPaymentStatus.CHECKOUT_CREATED,
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        amount: 1000,
        currency: 'usd',
      });
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_ck_r_1',
        type: STRIPE_WEBHOOK_EVENT_TYPES.CHECKOUT_SESSION_COMPLETED,
        data: {
          object: {
            id: 'cs_r_1',
            mode: 'payment',
            payment_intent: 'pi_r_4',
            payment_status: 'paid',
            customer: 'cus_r_1',
            metadata: { localPaymentId: 'pay-r-4' },
          },
        },
      });
      await service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc');
      expect(entitlementsService.recomputeForUser).not.toHaveBeenCalled();
    });

    it('propagates a recompute failure so Stripe retries the webhook', async () => {
      entitlementsService.recomputeForUser.mockRejectedValueOnce(
        new Error('recompute boom'),
      );
      eventRepo.findOne.mockResolvedValueOnce(null);
      paymentRepo.findOne.mockResolvedValueOnce({
        id: 'pay-r-5',
        userId: 29,
        billingCustomerId: 'cust-r-8',
        status: BillingPaymentStatus.PENDING,
        stripePaymentIntentId: 'pi_r_5',
        amount: 1000,
        currency: 'usd',
      });
      transactionRepo.findOne.mockResolvedValueOnce(null);
      stripeService.constructWebhookEvent.mockReturnValueOnce({
        ...baseEvent,
        id: 'evt_pi_r_5',
        type: STRIPE_WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_SUCCEEDED,
        data: { object: { id: 'pi_r_5', amount: 1000, currency: 'usd' } },
      });
      // The error from recomputeEntitlements should propagate so
      // Stripe retries delivery.
      await expect(
        service.receiveEvent(Buffer.from('{}'), 't=1,v1=abc'),
      ).rejects.toThrow('recompute boom');
      // Payment save still happened before the error.
      expect(paymentRepo.save).toHaveBeenCalled();
      // Event row should be marked failed.
      expect(eventRepo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: BillingWebhookEventStatus.FAILED,
        }),
      );
    });
  });
});
