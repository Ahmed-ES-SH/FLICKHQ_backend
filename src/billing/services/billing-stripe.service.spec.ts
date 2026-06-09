import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BillingError,
  StripeSignatureVerificationFailedError,
} from '../common/billing.errors';
import { STRIPE_CLIENT, BillingStripeService } from './billing-stripe.service';

describe('BillingStripeService', () => {
  let service: BillingStripeService;
  let client: {
    webhooks: {
      constructEvent: jest.Mock;
    };
  };

  beforeEach(async () => {
    client = {
      webhooks: {
        constructEvent: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingStripeService,
        {
          provide: STRIPE_CLIENT,
          useValue: client,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test_abc123';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(BillingStripeService);
  });

  describe('getClient', () => {
    it('returns the underlying Stripe instance', () => {
      expect(service.getClient()).toBe(client);
    });
  });

  describe('redactSecrets', () => {
    it('redacts Stripe keys from arbitrary strings', () => {
      const out = service.redactSecrets('sk_test_a and rk_live_b');
      expect(out).toBe('sk_test_[REDACTED] and rk_live_[REDACTED]');
    });

    it('passes through clean strings unchanged', () => {
      expect(service.redactSecrets('clean text')).toBe('clean text');
    });
  });

  describe('constructWebhookEvent', () => {
    const sampleEvent = { id: 'evt_1', type: 'customer.created' };

    it('returns the parsed event on a valid signature', () => {
      client.webhooks.constructEvent.mockReturnValue(sampleEvent);
      const result = service.constructWebhookEvent(
        '{"id":"evt_1"}',
        't=1,v1=abcd',
      );
      expect(result).toBe(sampleEvent);
      expect(client.webhooks.constructEvent).toHaveBeenCalledWith(
        '{"id":"evt_1"}',
        't=1,v1=abcd',
        'whsec_test_abc123',
      );
    });

    it('accepts a Buffer payload and forwards it as-is to the SDK', () => {
      client.webhooks.constructEvent.mockReturnValue(sampleEvent);
      const buf = Buffer.from('{"id":"evt_1"}');
      service.constructWebhookEvent(buf, 't=1,v1=abcd');
      expect(client.webhooks.constructEvent).toHaveBeenCalledWith(
        buf,
        't=1,v1=abcd',
        'whsec_test_abc123',
      );
    });

    it('throws when the signature is empty', () => {
      expect(() => service.constructWebhookEvent('{}', '')).toThrow(
        StripeSignatureVerificationFailedError,
      );
      expect(() => service.constructWebhookEvent('{}', '')).toThrow(
        /Missing Stripe-Signature/,
      );
    });

    it('wraps SDK errors as StripeSignatureVerificationFailedError', () => {
      client.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });
      try {
        service.constructWebhookEvent('{}', 'bad');
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(StripeSignatureVerificationFailedError);
        expect((err as Error).message).toMatch(/verification failed/);
        expect((err as Error).message).toMatch(/No signatures/);
      }
    });

    it('rejects non-string non-Buffer payloads', () => {
      // @ts-expect-error testing runtime guard
      expect(() => service.constructWebhookEvent(123, 'sig')).toThrow(
        BillingError,
      );
    });

    it('throws when the webhook secret is missing entirely', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BillingStripeService,
          {
            provide: STRIPE_CLIENT,
            useValue: client,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();

      const svc = module.get(BillingStripeService);
      expect(() => svc.constructWebhookEvent('{}', 'sig')).toThrow(
        BillingError,
      );
      expect(() => svc.constructWebhookEvent('{}', 'sig')).toThrow(
        /STRIPE_WEBHOOK_SECRET/,
      );
    });
  });

  describe('safeCall', () => {
    it('returns the result of the operation on success', async () => {
      const op = jest.fn().mockResolvedValue({ ok: true });
      await expect(service.safeCall(op)).resolves.toEqual({ ok: true });
    });

    it('redacts the error message from a thrown Stripe SDK error', async () => {
      const sdkError = new Error('Boom: sk_test_leaked123');
      const op = jest.fn().mockRejectedValue(sdkError);
      await expect(service.safeCall(op)).rejects.toMatchObject({
        message: 'Boom: sk_test_[REDACTED]',
      });
    });

    it('redacts the .raw payload of a Stripe SDK error', async () => {
      const sdkError = Object.assign(new Error('Failed'), {
        raw: { requestId: 'req_1', secret: 'whsec_secretex' },
      });
      const op = jest.fn().mockRejectedValue(sdkError);
      const caught = (await service
        .safeCall(op)
        .catch((e: unknown) => e as Error)) as Error;
      expect(caught).toBeDefined();
      expect(caught.message).toBe('Failed');
      const raw = (caught as unknown as { raw: unknown }).raw;
      expect(JSON.stringify(raw)).not.toContain('whsec_secretex');
      expect(JSON.stringify(raw)).toContain('whsec_[REDACTED]');
    });

    it('handles non-Error throws by rewrapping as an Error with redacted content', async () => {
      const op = jest.fn().mockRejectedValue('string sk_test_a');
      const caught = (await service
        .safeCall(op)
        .catch((e: unknown) => e as Error)) as Error;
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toContain('sk_test_[REDACTED]');
    });
  });
});
