import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';

import { BillingIdempotencyService } from './billing-idempotency.service';
import { BillingIdempotencyKey } from '../entities/billing-idempotency-key.entity';
import { BillingIdempotencyStatus } from '../common/billing.enums';
import {
  BillingIdempotencyConflictError,
  BillingIdempotencyInFlightError,
} from '../common/billing.errors';

interface IdempotencyRepoMock {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
}

describe('BillingIdempotencyService', () => {
  let service: BillingIdempotencyService;
  let repo: IdempotencyRepoMock;

  const buildRow = (overrides: Partial<BillingIdempotencyKey> = {}) => ({
    id: 'row-1',
    key: 'key-1',
    scope: 'checkout.one_time',
    userId: 7,
    requestHash: service.hashRequest({ priceId: 'p1' }),
    responseSnapshot: null,
    status: BillingIdempotencyStatus.IN_PROGRESS,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as BillingIdempotencyKey),
      save: jest.fn((entity) =>
        Promise.resolve(entity as BillingIdempotencyKey),
      ),
      update: jest.fn().mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingIdempotencyService,
        {
          provide: getRepositoryToken(BillingIdempotencyKey),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get(BillingIdempotencyService);
  });

  describe('normalizeKey', () => {
    it('trims whitespace', () => {
      expect(service.normalizeKey('  key-1  ')).toBe('key-1');
    });

    it('rejects missing input', () => {
      expect(() => service.normalizeKey(undefined)).toThrow(/required/);
      expect(() => service.normalizeKey(null)).toThrow(/required/);
    });

    it('rejects empty strings', () => {
      expect(() => service.normalizeKey('   ')).toThrow(/cannot be empty/);
    });

    it('rejects overly long values', () => {
      expect(() => service.normalizeKey('a'.repeat(256))).toThrow(/too long/);
    });
  });

  describe('hashRequest', () => {
    it('produces the same hash regardless of property order', () => {
      const a = service.hashRequest({ a: 1, b: 2 });
      const b = service.hashRequest({ b: 2, a: 1 });
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hashes for different content', () => {
      const a = service.hashRequest({ a: 1 });
      const b = service.hashRequest({ a: 2 });
      expect(a).not.toBe(b);
    });
  });

  describe('reserve', () => {
    it('returns fresh=true when the key is new', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      const result = await service.reserve({
        key: 'key-1',
        scope: 'checkout.one_time',
        userId: 7,
        request: { priceId: 'p1' },
      });
      expect(result.fresh).toBe(true);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('returns cached response when the key is completed and the request body matches', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.COMPLETED,
        responseSnapshot: { url: 'https://cached.stripe/x' },
      });
      repo.findOne.mockResolvedValueOnce(existing);
      const result = await service.reserve({
        key: 'key-1',
        scope: 'checkout.one_time',
        userId: 7,
        request: { priceId: 'p1' },
      });
      expect(result.fresh).toBe(false);
      expect(result.cachedResponse).toEqual({ url: 'https://cached.stripe/x' });
    });

    it('returns retriable=true and flips the row back to in_progress when the key was failed', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.FAILED,
        responseSnapshot: null,
      });
      repo.findOne.mockResolvedValueOnce(existing);
      const result = await service.reserve({
        key: 'key-1',
        scope: 'checkout.one_time',
        userId: 7,
        request: { priceId: 'p1' },
      });
      expect(result.fresh).toBe(false);
      expect(result.retriable).toBe(true);
      expect(repo.update).toHaveBeenCalledWith(
        {
          key: 'key-1',
          status: BillingIdempotencyStatus.FAILED,
        },
        expect.objectContaining({
          status: BillingIdempotencyStatus.IN_PROGRESS,
        }),
      );
    });

    it('throws BillingIdempotencyInFlightError when the key is in_progress', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.IN_PROGRESS,
      });
      repo.findOne.mockResolvedValueOnce(existing);
      await expect(
        service.reserve({
          key: 'key-1',
          scope: 'checkout.one_time',
          userId: 7,
          request: { priceId: 'p1' },
        }),
      ).rejects.toBeInstanceOf(BillingIdempotencyInFlightError);
    });

    it('throws BillingIdempotencyConflictError when the key was reused with a different body', async () => {
      const existing = buildRow();
      repo.findOne.mockResolvedValueOnce(existing);
      await expect(
        service.reserve({
          key: 'key-1',
          scope: 'checkout.one_time',
          userId: 7,
          request: { priceId: 'p2' },
        }),
      ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);
    });

    it('flips an expired FAILED row back to in_progress and marks it retriable', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.FAILED,
        expiresAt: new Date(Date.now() - 1_000),
      });
      repo.findOne.mockResolvedValueOnce(existing);
      const result = await service.reserve({
        key: 'key-1',
        scope: 'checkout.one_time',
        userId: 7,
        request: { priceId: 'p1' },
      });
      expect(result.retriable).toBe(true);
      expect(repo.update).toHaveBeenCalledWith(
        {
          key: 'key-1',
          status: In([
            BillingIdempotencyStatus.FAILED,
            BillingIdempotencyStatus.EXPIRED,
          ]),
        },
        expect.objectContaining({
          status: BillingIdempotencyStatus.IN_PROGRESS,
        }),
      );
    });

    it('throws in-flight for an expired IN_PROGRESS row (crashed worker)', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.IN_PROGRESS,
        expiresAt: new Date(Date.now() - 1_000),
      });
      repo.findOne.mockResolvedValueOnce(existing);
      await expect(
        service.reserve({
          key: 'key-1',
          scope: 'checkout.one_time',
          userId: 7,
          request: { priceId: 'p1' },
        }),
      ).rejects.toBeInstanceOf(BillingIdempotencyInFlightError);
    });

    it('returns cached response from an expired COMPLETED row', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.COMPLETED,
        expiresAt: new Date(Date.now() - 1_000),
        responseSnapshot: { url: 'https://cached.stripe/x' },
      });
      repo.findOne.mockResolvedValueOnce(existing);
      const result = await service.reserve({
        key: 'key-1',
        scope: 'checkout.one_time',
        userId: 7,
        request: { priceId: 'p1' },
      });
      expect(result.fresh).toBe(false);
      expect(result.retriable).toBe(false);
      expect(result.cachedResponse).toEqual({ url: 'https://cached.stripe/x' });
      // No update should have been made — the cached response is served.
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('falls back to re-reading the winner when the create race triggers a unique violation', async () => {
      repo.findOne
        .mockResolvedValueOnce(null) // initial lookup
        .mockResolvedValueOnce(
          buildRow({
            status: BillingIdempotencyStatus.COMPLETED,
            responseSnapshot: { url: 'https://winner/x' },
          }),
        );
      repo.save.mockRejectedValueOnce(new Error('duplicate key'));

      const result = await service.reserve({
        key: 'key-1',
        scope: 'checkout.one_time',
        userId: 7,
        request: { priceId: 'p1' },
      });
      expect(result.fresh).toBe(false);
      expect(result.cachedResponse).toEqual({ url: 'https://winner/x' });
    });
  });

  describe('recordSuccess', () => {
    it('updates the row in place via save()', async () => {
      const existing = buildRow();
      repo.findOne.mockResolvedValueOnce(existing);
      await service.recordSuccess('key-1', { url: 'https://new/x' });
      expect(existing.status).toBe(BillingIdempotencyStatus.COMPLETED);
      expect(existing.responseSnapshot).toEqual({ url: 'https://new/x' });
      expect(repo.save).toHaveBeenCalledWith(existing);
    });

    it('is a no-op when the row no longer exists', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await service.recordSuccess('key-1', { url: 'https://new/x' });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('recordFailure', () => {
    it('marks the row failed and clears any cached response', async () => {
      const existing = buildRow({
        status: BillingIdempotencyStatus.IN_PROGRESS,
        responseSnapshot: { url: 'x' },
      });
      repo.findOne.mockResolvedValueOnce(existing);
      await service.recordFailure('key-1');
      expect(existing.status).toBe(BillingIdempotencyStatus.FAILED);
      expect(existing.responseSnapshot).toBeNull();
    });
  });

  describe('release', () => {
    it('deletes the row by key', async () => {
      await service.release('key-1');
      expect(repo.delete).toHaveBeenCalledWith({ key: 'key-1' });
    });
  });
});
