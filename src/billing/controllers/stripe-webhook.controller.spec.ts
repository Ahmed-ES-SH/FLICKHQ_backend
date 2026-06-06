/**
 * HTTP-layer tests for `StripeWebhookController`.
 *
 * We bypass the database and Stripe SDK by mocking
 * `BillingWebhookService` directly. The goal is to verify the
 * route contract: public, raw-body only, signature required,
 * correct status codes for each result kind.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

import { StripeWebhookController } from './stripe-webhook.controller';
import { BillingWebhookService } from '../services/billing-webhook.service';
import { StripeSignatureVerificationFailedError } from '../common/billing.errors';
import { BillingWebhookEventStatus } from '../common/billing.enums';

interface WebhookServiceMock {
  receiveEvent: jest.Mock;
}

interface MockRequest extends Partial<Request> {
  rawBody?: Buffer | string;
  headers: Record<string, string | string[] | undefined>;
}

const buildRequest = (
  signature: string | undefined,
  rawBody: Buffer | string | undefined,
): MockRequest => ({
  headers: signature
    ? { 'stripe-signature': signature }
    : { 'stripe-signature': undefined },
  rawBody,
});

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let webhook: WebhookServiceMock;

  beforeEach(async () => {
    webhook = { receiveEvent: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        {
          provide: BillingWebhookService,
          useValue: webhook,
        },
      ],
    }).compile();

    controller = module.get(StripeWebhookController);
  });

  describe('handleStripeWebhook', () => {
    it('returns 200 with kind=processed on a successful delivery', async () => {
      webhook.receiveEvent.mockResolvedValueOnce({
        kind: 'processed',
        stripeEventId: 'evt_1',
        eventType: 'customer.created',
      });
      const result = await controller.handleStripeWebhook(
        buildRequest('t=1,v1=abc', Buffer.from('{"id":"evt_1"}')) as Request,
      );
      expect(result).toEqual({
        kind: 'processed',
        stripeEventId: 'evt_1',
        eventType: 'customer.created',
        reason: null,
      });
      expect(webhook.receiveEvent).toHaveBeenCalledWith(
        expect.any(Buffer),
        't=1,v1=abc',
      );
    });

    it('returns 200 with kind=duplicate on a redelivery (handler does not run twice)', async () => {
      webhook.receiveEvent.mockResolvedValueOnce({
        kind: 'duplicate',
        stripeEventId: 'evt_dup',
        eventType: 'invoice.paid',
        originalStatus: BillingWebhookEventStatus.PROCESSED,
      });
      const result = await controller.handleStripeWebhook(
        buildRequest('t=1,v1=abc', Buffer.from('{"id":"evt_dup"}')) as Request,
      );
      expect(result.kind).toBe('duplicate');
      expect(result.stripeEventId).toBe('evt_dup');
    });

    it('returns 200 with kind=ignored on an unhandled event type', async () => {
      webhook.receiveEvent.mockResolvedValueOnce({
        kind: 'ignored',
        stripeEventId: 'evt_unk',
        eventType: 'some.future.event',
        reason: 'no matching local resource',
      });
      const result = await controller.handleStripeWebhook(
        buildRequest('t=1,v1=abc', Buffer.from('{"id":"evt_unk"}')) as Request,
      );
      expect(result.kind).toBe('ignored');
      expect(result.reason).toBe('no matching local resource');
    });

    it('returns 200 with kind=failed when the service reports a permanent failure', async () => {
      webhook.receiveEvent.mockResolvedValueOnce({
        kind: 'failed',
        stripeEventId: 'evt_fail',
        eventType: 'invoice.payment_failed',
        errorMessage: 'orphan invoice',
      });
      const result = await controller.handleStripeWebhook(
        buildRequest('t=1,v1=abc', Buffer.from('{"id":"evt_fail"}')) as Request,
      );
      expect(result.kind).toBe('failed');
      expect(result.reason).toBe('orphan invoice');
    });

    it('throws 400 when the Stripe-Signature header is missing', async () => {
      await expect(
        controller.handleStripeWebhook(
          buildRequest(undefined, Buffer.from('{}')) as Request,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(webhook.receiveEvent).not.toHaveBeenCalled();
    });

    it('throws 400 when the request body is empty / already consumed', async () => {
      await expect(
        controller.handleStripeWebhook(
          buildRequest('t=1,v1=abc', undefined) as Request,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(webhook.receiveEvent).not.toHaveBeenCalled();
    });

    it('translates StripeSignatureVerificationFailedError to a 400', async () => {
      webhook.receiveEvent.mockRejectedValueOnce(
        new StripeSignatureVerificationFailedError('bad sig'),
      );
      await expect(
        controller.handleStripeWebhook(
          buildRequest('t=1,v1=BAD', Buffer.from('{}')) as Request,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rethrows unexpected service errors so Stripe can retry (5xx)', async () => {
      const boom = new Error('database is down');
      webhook.receiveEvent.mockRejectedValueOnce(boom);
      await expect(
        controller.handleStripeWebhook(
          buildRequest('t=1,v1=abc', Buffer.from('{}')) as Request,
        ),
      ).rejects.toBe(boom);
    });

    it('passes a Buffer (not a parsed object) to the service', async () => {
      webhook.receiveEvent.mockResolvedValueOnce({
        kind: 'processed',
        stripeEventId: 'evt_1',
        eventType: 'customer.created',
      });
      const body = Buffer.from('{"id":"evt_1"}');
      await controller.handleStripeWebhook(
        buildRequest('t=1,v1=abc', body) as Request,
      );
      const call = webhook.receiveEvent.mock.calls[0] as [Buffer, string];
      expect(Buffer.isBuffer(call[0])).toBe(true);
      expect(call[0].toString('utf8')).toBe('{"id":"evt_1"}');
    });

    it('coerces a string raw body to a Buffer before passing to the service', async () => {
      webhook.receiveEvent.mockResolvedValueOnce({
        kind: 'processed',
        stripeEventId: 'evt_1',
        eventType: 'customer.created',
      });
      await controller.handleStripeWebhook(
        buildRequest('t=1,v1=abc', '{"id":"evt_1"}') as Request,
      );
      const call = webhook.receiveEvent.mock.calls[0] as [Buffer, string];
      expect(Buffer.isBuffer(call[0])).toBe(true);
    });
  });
});
