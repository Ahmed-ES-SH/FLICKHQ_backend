/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { BillingPortalService } from './billing-portal.service';
import { BillingStripeService } from './billing-stripe.service';
import { BillingCustomerService } from './billing-customer.service';
import { BillingIdempotencyService } from './billing-idempotency.service';
import { BillingCustomer } from '../entities/billing-customer.entity';
import {
  BillingCustomerNotFoundError,
  BillingIdempotencyConflictError,
  BillingIdempotencyInFlightError,
} from '../common/billing.errors';

interface StripeBillingPortalMock {
  sessions: {
    create: jest.Mock;
  };
}

interface IdempotencyServiceMock {
  normalizeKey: jest.Mock;
  reserve: jest.Mock;
  recordSuccess: jest.Mock;
  recordFailure: jest.Mock;
}

describe('BillingPortalService', () => {
  let service: BillingPortalService;
  let stripeService: jest.Mocked<BillingStripeService>;
  let customerService: jest.Mocked<BillingCustomerService>;
  let portal: StripeBillingPortalMock;
  let idempotency: IdempotencyServiceMock;

  const sampleCustomer: BillingCustomer = {
    id: 'cust-1',
    userId: 7,
    stripeCustomerId: 'cus_stripe_1',
    email: 'u@example.com',
    name: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buildIdempotencyService = (): IdempotencyServiceMock => ({
    normalizeKey: jest.fn((k: string) => k),
    reserve: jest.fn(),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  });

  const buildModule = async (
    configOverride: Record<string, string | undefined>,
  ): Promise<{
    module: TestingModule;
    portal: StripeBillingPortalMock;
    customerService: jest.Mocked<BillingCustomerService>;
    stripeService: jest.Mocked<BillingStripeService>;
    idempotency: IdempotencyServiceMock;
  }> => {
    portal = {
      sessions: { create: jest.fn() },
    };
    stripeService = {
      getClient: jest.fn(() => ({ billingPortal: portal }) as never),
      safeCall: jest.fn((op: () => Promise<unknown>) => op()),
    } as unknown as jest.Mocked<BillingStripeService>;
    customerService = {
      getOrCreateForUser: jest.fn(),
    } as unknown as jest.Mocked<BillingCustomerService>;
    idempotency = buildIdempotencyService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingPortalService,
        { provide: BillingStripeService, useValue: stripeService },
        { provide: BillingCustomerService, useValue: customerService },
        { provide: BillingIdempotencyService, useValue: idempotency },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configOverride[key]),
          },
        },
      ],
    }).compile();

    return { module, portal, customerService, stripeService, idempotency };
  };

  it('returns the portal URL for a known user and persists idempotency', async () => {
    const built = await buildModule({
      STRIPE_PORTAL_RETURN_URL: 'https://app.example.com/billing/return',
    });
    service = built.module.get(BillingPortalService);
    built.idempotency.reserve.mockResolvedValueOnce({
      fresh: true,
      cachedResponse: null,
      retriable: false,
    });
    built.customerService.getOrCreateForUser.mockResolvedValueOnce(
      sampleCustomer,
    );
    built.portal.sessions.create.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/p/session/xxx',
    });

    const result = await service.createSessionForUser(7, 'key-1');

    expect(result.url).toBe('https://billing.stripe.com/p/session/xxx');
    expect(built.portal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_stripe_1',
      return_url: 'https://app.example.com/billing/return',
    });
    expect(built.idempotency.normalizeKey).toHaveBeenCalledWith('key-1');
    expect(built.idempotency.recordSuccess).toHaveBeenCalledWith(
      'key-1',
      expect.objectContaining({
        url: 'https://billing.stripe.com/p/session/xxx',
      }),
    );
    expect(built.idempotency.recordFailure).not.toHaveBeenCalled();
  });

  it('returns the cached response on idempotent replay', async () => {
    const built = await buildModule({
      STRIPE_PORTAL_RETURN_URL: 'https://app.example.com/billing/return',
    });
    service = built.module.get(BillingPortalService);
    built.idempotency.reserve.mockResolvedValueOnce({
      fresh: false,
      cachedResponse: { url: 'https://cached.stripe.example/session/cached' },
      retriable: false,
    });

    const result = await service.createSessionForUser(7, 'key-1');

    expect(result.url).toBe('https://cached.stripe.example/session/cached');
    expect(built.portal.sessions.create).not.toHaveBeenCalled();
    expect(built.customerService.getOrCreateForUser).not.toHaveBeenCalled();
  });

  it('throws BillingCustomerNotFoundError when the customer cannot be created', async () => {
    const built = await buildModule({
      STRIPE_PORTAL_RETURN_URL: 'https://app.example.com/billing/return',
    });
    service = built.module.get(BillingPortalService);
    built.idempotency.reserve.mockResolvedValueOnce({
      fresh: true,
      cachedResponse: null,
      retriable: false,
    });
    built.customerService.getOrCreateForUser.mockResolvedValueOnce(
      null as unknown as BillingCustomer,
    );
    await expect(
      service.createSessionForUser(7, 'key-1'),
    ).rejects.toBeInstanceOf(BillingCustomerNotFoundError);
    expect(built.idempotency.recordFailure).toHaveBeenCalledWith('key-1');
  });

  it('throws a clear error when no return URL is configured', async () => {
    const built = await buildModule({});
    service = built.module.get(BillingPortalService);
    built.idempotency.reserve.mockResolvedValueOnce({
      fresh: true,
      cachedResponse: null,
      retriable: false,
    });
    built.customerService.getOrCreateForUser.mockResolvedValueOnce(
      sampleCustomer,
    );
    await expect(service.createSessionForUser(7, 'key-1')).rejects.toThrow(
      /STRIPE_PORTAL_RETURN_URL/,
    );
  });

  it('lets BillingIdempotencyConflictError / InFlightError propagate unchanged', async () => {
    const built = await buildModule({
      STRIPE_PORTAL_RETURN_URL: 'https://app.example.com/billing/return',
    });
    service = built.module.get(BillingPortalService);
    built.idempotency.reserve.mockRejectedValueOnce(
      new BillingIdempotencyConflictError('key-1'),
    );
    await expect(
      service.createSessionForUser(7, 'key-1'),
    ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);

    built.idempotency.reserve.mockRejectedValueOnce(
      new BillingIdempotencyInFlightError('key-1'),
    );
    await expect(
      service.createSessionForUser(7, 'key-1'),
    ).rejects.toBeInstanceOf(BillingIdempotencyInFlightError);
  });
});
