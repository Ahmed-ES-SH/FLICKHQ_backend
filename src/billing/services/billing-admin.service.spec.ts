import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { BillingAdminService } from './billing-admin.service';
import { BillingStripeService } from './billing-stripe.service';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingIdempotencyService } from './billing-idempotency.service';

import { BillingCustomer } from '../entities/billing-customer.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import { BillingWebhookEvent } from '../entities/billing-webhook-event.entity';

import {
  BillingPaymentStatus,
  BillingTransactionType,
  BillingWebhookEventStatus,
} from '../common/billing.enums';

interface RepoMock {
  count: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
  findAndCount: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  createQueryBuilder: jest.Mock;
}

interface StripeServiceMock {
  getClient: jest.Mock;
  safeCall: jest.Mock;
  redactSecrets: jest.Mock;
}

interface WebhookServiceMock {
  replayEvent: jest.Mock;
}

interface IdempotencyServiceMock {
  normalizeKey: jest.Mock;
  reserve: jest.Mock;
  recordSuccess: jest.Mock;
  recordFailure: jest.Mock;
}

interface EventEmitterMock {
  emit: jest.Mock;
}

function buildRepoMock(): RepoMock {
  return {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((dto: unknown) => dto),
    save: jest.fn((e: unknown) => Promise.resolve(e)),
    createQueryBuilder: jest.fn(),
  };
}

describe('BillingAdminService', () => {
  let service: BillingAdminService;
  let customerRepo: RepoMock;
  let subscriptionRepo: RepoMock;
  let paymentRepo: RepoMock;
  let transactionRepo: RepoMock;
  let webhookEventRepo: RepoMock;
  let stripeService: StripeServiceMock;
  let webhookService: WebhookServiceMock;
  let idempotency: IdempotencyServiceMock;
  let eventEmitter: EventEmitterMock;

  beforeEach(async () => {
    customerRepo = buildRepoMock();
    subscriptionRepo = buildRepoMock();
    paymentRepo = buildRepoMock();
    transactionRepo = buildRepoMock();
    webhookEventRepo = buildRepoMock();

    stripeService = {
      getClient: jest.fn(),
      safeCall: jest.fn(),
      redactSecrets: jest.fn((s: string) => s),
    };
    webhookService = {
      replayEvent: jest.fn(),
    };
    idempotency = {
      normalizeKey: jest.fn((k: string) => k),
      reserve: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingAdminService,
        {
          provide: getRepositoryToken(BillingCustomer),
          useValue: customerRepo,
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
          provide: getRepositoryToken(BillingTransaction),
          useValue: transactionRepo,
        },
        {
          provide: getRepositoryToken(BillingWebhookEvent),
          useValue: webhookEventRepo,
        },
        { provide: BillingStripeService, useValue: stripeService },
        { provide: BillingWebhookService, useValue: webhookService },
        { provide: BillingIdempotencyService, useValue: idempotency },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(BillingAdminService);
  });

  // ─────────────────────────────────────────────────────────────────
  // getOverview
  // ─────────────────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('returns the operational snapshot', async () => {
      customerRepo.count.mockResolvedValueOnce(5);

      const subQueryBuilder = {
        select: () => ({
          addSelect: () => ({
            groupBy: () => ({
              orderBy: () => ({
                getRawMany: () =>
                  Promise.resolve([
                    { status: 'active', count: '3' },
                    { status: 'trialing', count: '1' },
                    { status: 'canceled', count: '2' },
                  ]),
              }),
            }),
          }),
        }),
      };
      subscriptionRepo.createQueryBuilder.mockReturnValueOnce(subQueryBuilder);

      paymentRepo.find.mockResolvedValueOnce([
        {
          id: 'fail-1',
          userId: 1,
          amount: 1000,
          currency: 'usd',
          description: 'Failed charge',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]);

      webhookEventRepo.count.mockResolvedValueOnce(3);

      const result = await service.getOverview();

      expect(result.totalCustomers).toBe(5);
      expect(result.subscriptionsByStatus).toHaveLength(3);
      expect(result.subscriptionsByStatus[0]).toEqual({
        status: 'active',
        count: 3,
      });
      expect(result.recentFailedPayments).toHaveLength(1);
      expect(result.failedWebhooksCount).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // listFailedWebhooks
  // ─────────────────────────────────────────────────────────────────

  describe('listFailedWebhooks', () => {
    it('returns failed webhook events ordered by receivedAt desc', async () => {
      const rows = [
        {
          id: 'wh-1',
          stripeEventId: 'evt_1',
          eventType: 'payment_intent.succeeded',
          errorMessage: 'something went wrong',
          processingAttempts: 2,
          status: BillingWebhookEventStatus.FAILED,
          receivedAt: new Date('2024-01-02T00:00:00Z'),
          processedAt: null,
        },
        {
          id: 'wh-2',
          stripeEventId: 'evt_2',
          eventType: 'customer.subscription.updated',
          errorMessage: 'DB timeout',
          processingAttempts: 1,
          status: BillingWebhookEventStatus.FAILED,
          receivedAt: new Date('2024-01-01T00:00:00Z'),
          processedAt: null,
        },
      ];
      webhookEventRepo.findAndCount.mockResolvedValueOnce([rows, 2]);

      const result = await service.listFailedWebhooks(100);

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.stripeEventId).toBe('evt_1');
      expect(result.data[0]!.errorMessage).toBe('something went wrong');
      expect(result.data[1]!.stripeEventId).toBe('evt_2');
    });

    it('respects the limit parameter (max 500)', async () => {
      webhookEventRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      await service.listFailedWebhooks(10);
      expect(webhookEventRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // replayWebhook
  // ─────────────────────────────────────────────────────────────────

  describe('replayWebhook', () => {
    it('delegates to BillingWebhookService.replayEvent', async () => {
      const replayResult = {
        kind: 'processed' as const,
        stripeEventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
      };
      webhookService.replayEvent.mockResolvedValueOnce(replayResult);

      const result = await service.replayWebhook('event-id-1');

      expect(webhookService.replayEvent).toHaveBeenCalledWith('event-id-1');
      expect(result).toEqual(replayResult);
    });

    it('returns null when the event does not exist', async () => {
      webhookService.replayEvent.mockResolvedValueOnce(null);
      const result = await service.replayWebhook('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // refundPayment
  // ─────────────────────────────────────────────────────────────────

  describe('refundPayment', () => {
    function makePayment(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'pay-1',
        userId: 42,
        billingCustomerId: 'cust-1',
        amount: 1000,
        amountRefunded: 0,
        currency: 'usd',
        status: BillingPaymentStatus.SUCCEEDED,
        stripePaymentIntentId: 'pi_1',
        description: 'Test payment',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    beforeEach(() => {
      idempotency.normalizeKey.mockImplementation((k: string) => k);
    });

    it('returns a cached response on idempotent replay', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: false,
        cachedResponse: {
          transactionId: 'tx-1',
          stripeRefundId: 're_1',
          amount: 1000,
          currency: 'usd',
          status: 'succeeded',
        },
      });
      const result = await service.refundPayment('pay-1', 'idemp-1', 1000);
      expect(result.transactionId).toBe('tx-1');
      expect(paymentRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when payment does not exist', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.refundPayment('bad-id', 'idemp-1')).rejects.toThrow(
        /not found/,
      );
      expect(idempotency.recordFailure).toHaveBeenCalled();
    });

    it('throws BadRequestException when payment is not refundable', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(
        makePayment({ status: BillingPaymentStatus.FAILED }),
      );

      await expect(service.refundPayment('pay-1', 'idemp-1')).rejects.toThrow(
        /cannot be refunded/,
      );
    });

    it('throws BadRequestException when payment is fully refunded', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(
        makePayment({ amountRefunded: 1000 }),
      );

      await expect(service.refundPayment('pay-1', 'idemp-1')).rejects.toThrow(
        /fully refunded/,
      );
    });

    it('throws BadRequestException when no Stripe PaymentIntent id', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(
        makePayment({ stripePaymentIntentId: null }),
      );

      await expect(service.refundPayment('pay-1', 'idemp-1')).rejects.toThrow(
        /no Stripe PaymentIntent/,
      );
    });

    it('calls Stripe refunds.create and records a transaction', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(makePayment());

      stripeService.safeCall.mockImplementationOnce(
        (fn: () => Promise<unknown>) =>
          fn().catch((e: unknown) => Promise.reject(e)),
      );
      stripeService.getClient.mockReturnValue({
        refunds: {
          create: jest.fn().mockResolvedValueOnce({
            id: 're_1',
            status: 'succeeded',
          }),
        },
      });

      const result = await service.refundPayment('pay-1', 'idemp-1', 500);

      expect(result.stripeRefundId).toBe('re_1');
      expect(result.amount).toBe(500);
      expect(result.currency).toBe('usd');

      expect(transactionRepo.save).toHaveBeenCalled();
      const savedTx = transactionRepo.save.mock.calls[0][0];
      expect(savedTx.type).toBe(BillingTransactionType.REFUND);
      expect(savedTx.amount).toBe(500);

      expect(paymentRepo.save).toHaveBeenCalled();
      const savedPayment = paymentRepo.save.mock.calls[0][0];
      expect(savedPayment.amountRefunded).toBe(500);
      expect(savedPayment.status).toBe(BillingPaymentStatus.PARTIALLY_REFUNDED);

      expect(idempotency.recordSuccess).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('flips payment to REFUNDED when total refunded >= amount', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(makePayment());

      stripeService.safeCall.mockImplementationOnce(
        (fn: () => Promise<unknown>) =>
          fn().catch((e: unknown) => Promise.reject(e)),
      );
      stripeService.getClient.mockReturnValue({
        refunds: {
          create: jest.fn().mockResolvedValueOnce({
            id: 're_full',
            status: 'succeeded',
          }),
        },
      });

      await service.refundPayment('pay-1', 'idemp-1', 1000);

      const savedPayment = paymentRepo.save.mock.calls[0][0];
      expect(savedPayment.amountRefunded).toBe(1000);
      expect(savedPayment.status).toBe(BillingPaymentStatus.REFUNDED);
    });

    it('validates the refund amount against the refundable balance', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(makePayment());

      await expect(
        service.refundPayment('pay-1', 'idemp-1', 2000),
      ).rejects.toThrow(/Refund amount/);
    });

    it('records failure and rethrows on Stripe error', async () => {
      idempotency.reserve.mockResolvedValueOnce({
        fresh: true,
        cachedResponse: null,
      });
      paymentRepo.findOne.mockResolvedValueOnce(makePayment());

      stripeService.safeCall.mockRejectedValueOnce(
        new Error('Stripe API error'),
      );

      await expect(
        service.refundPayment('pay-1', 'idemp-1', 500),
      ).rejects.toThrow(/Stripe API error/);

      expect(idempotency.recordFailure).toHaveBeenCalled();
    });
  });
});
