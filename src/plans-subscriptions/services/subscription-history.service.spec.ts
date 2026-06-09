import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { PlanSubscriptionHistory } from '../entities/plan-subscription-history.entity';
import { SubscriptionHistoryService } from './subscription-history.service';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';
import { BILLING_EVENTS } from '../../billing/common/billing.constants';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

interface RepoMock {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

const mockHistory = (
  overrides: Partial<PlanSubscriptionHistory> = {},
): PlanSubscriptionHistory => ({
  id: 'hist-uuid-1',
  userId: 1,
  subscriptionId: 'sub-uuid-1',
  previousStatus: null,
  newStatus: BillingSubscriptionStatus.ACTIVE,
  planId: null,
  priceId: null,
  stripeEventId: null,
  reason: null,
  metadata: {},
  occurredAt: new Date('2025-01-01T00:00:00Z'),
  createdAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('SubscriptionHistoryService', () => {
  let service: SubscriptionHistoryService;
  let repo: RepoMock;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((dto) => dto as PlanSubscriptionHistory),
      save: jest.fn((entry) =>
        Promise.resolve(entry as PlanSubscriptionHistory),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionHistoryService,
        {
          provide: getRepositoryToken(PlanSubscriptionHistory),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<SubscriptionHistoryService>(
      SubscriptionHistoryService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordStatusChange', () => {
    it('should insert a history entry', async () => {
      repo.save.mockResolvedValueOnce(mockHistory());

      await service.recordStatusChange({
        userId: 1,
        subscriptionId: 'sub-uuid-1',
        previousStatus: null,
        newStatus: BillingSubscriptionStatus.ACTIVE,
        planId: null,
        priceId: null,
        stripeEventId: 'evt_123',
        reason: 'webhook: sub.updated',
        metadata: { periodStart: '2025-01-01' },
        occurredAt: new Date('2025-01-01T12:00:00Z'),
      });

      expect(repo.create).toHaveBeenCalledWith({
        userId: 1,
        subscriptionId: 'sub-uuid-1',
        previousStatus: null,
        newStatus: BillingSubscriptionStatus.ACTIVE,
        planId: null,
        priceId: null,
        stripeEventId: 'evt_123',
        reason: 'webhook: sub.updated',
        metadata: { periodStart: '2025-01-01' },
        occurredAt: new Date('2025-01-01T12:00:00Z'),
      });
      expect(repo.save).toHaveBeenCalled();
    });

    it('should silently skip duplicate stripeEventId', async () => {
      const uniqueViolation = new QueryFailedError(
        'INSERT INTO ...',
        [],
        new Error('duplicate key value violates unique constraint'),
      );
      (uniqueViolation as any).code = '23505';
      repo.save.mockRejectedValueOnce(uniqueViolation);

      await expect(
        service.recordStatusChange({
          userId: 1,
          subscriptionId: 'sub-uuid-1',
          previousStatus: null,
          newStatus: BillingSubscriptionStatus.ACTIVE,
          planId: null,
          priceId: null,
          stripeEventId: 'evt_dup',
          reason: 'webhook: duplicate',
        }),
      ).resolves.toBeUndefined();
    });

    it('should rethrow non-unique-violation errors', async () => {
      const genericError = new Error('DB connection lost');
      repo.save.mockRejectedValueOnce(genericError);

      await expect(
        service.recordStatusChange({
          userId: 1,
          subscriptionId: null,
          previousStatus: null,
          newStatus: BillingSubscriptionStatus.ACTIVE,
          planId: null,
          priceId: null,
          stripeEventId: null,
          reason: 'test',
        }),
      ).rejects.toThrow('DB connection lost');
    });

    it('should use current date when occurredAt not provided', async () => {
      const before = new Date();
      repo.save.mockResolvedValueOnce(mockHistory());

      await service.recordStatusChange({
        userId: 1,
        subscriptionId: null,
        previousStatus: null,
        newStatus: BillingSubscriptionStatus.TRIALING,
        planId: null,
        priceId: null,
        stripeEventId: null,
        reason: 'test',
      });

      const createCall = repo.create.mock.calls[0]![0];
      expect(createCall.occurredAt).toBeInstanceOf(Date);
      expect(createCall.occurredAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 100,
      );
    });
  });

  describe('getHistoryForSubscription', () => {
    it('should return timeline ordered by occurredAt DESC', async () => {
      const records = [
        mockHistory({
          occurredAt: new Date('2025-02-01T00:00:00Z'),
          newStatus: BillingSubscriptionStatus.CANCELED,
        }),
        mockHistory({
          occurredAt: new Date('2025-01-15T00:00:00Z'),
          newStatus: BillingSubscriptionStatus.ACTIVE,
        }),
        mockHistory({
          occurredAt: new Date('2025-01-01T00:00:00Z'),
          newStatus: BillingSubscriptionStatus.TRIALING,
        }),
      ];
      repo.find.mockResolvedValueOnce(records);

      const result = await service.getHistoryForSubscription('sub-uuid-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-uuid-1' },
        order: { occurredAt: 'DESC' },
      });
      expect(result).toHaveLength(3);
      expect(result[0]!.newStatus).toBe(BillingSubscriptionStatus.CANCELED);
    });

    it('should return empty array when no history', async () => {
      repo.find.mockResolvedValueOnce([]);

      const result = await service.getHistoryForSubscription('sub-unknown');

      expect(result).toEqual([]);
    });
  });

  describe('getHistoryForUser', () => {
    it('should return paginated history for a user', async () => {
      const records = [
        mockHistory({
          id: 'h1',
          newStatus: BillingSubscriptionStatus.CANCELED,
        }),
        mockHistory({ id: 'h2', newStatus: BillingSubscriptionStatus.ACTIVE }),
      ];
      repo.findAndCount.mockResolvedValueOnce([records, 2]);

      const pagination: PaginationQueryDto = { page: 1, limit: 20 };
      const result = await service.getHistoryForUser(1, pagination);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should apply skip for pagination', async () => {
      repo.findAndCount.mockResolvedValueOnce([[], 10]);

      await service.getHistoryForUser(1, { page: 3, limit: 5 });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });

    it('should use defaults when pagination fields are undefined', async () => {
      repo.findAndCount.mockResolvedValueOnce([[], 0]);

      await service.getHistoryForUser(1, { page: 1, limit: 20 });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should compute totalPages correctly', async () => {
      repo.findAndCount.mockResolvedValueOnce([
        Array(5)
          .fill(null)
          .map((_, i) => mockHistory({ id: `h${i}` })),
        23,
      ]);

      const result = await service.getHistoryForUser(1, { page: 2, limit: 5 });

      expect(result.totalPages).toBe(5); // ceil(23/5) = 5
      expect(result.items).toHaveLength(5);
    });
  });

  // ─────────────────────────────────────────────
  // Event listeners
  // ─────────────────────────────────────────────

  describe('event handlers', () => {
    it('should record history on SUBSCRIPTION_CREATED event', async () => {
      repo.save.mockResolvedValueOnce(mockHistory());

      const payload = {
        userId: 1,
        billingCustomerId: 'bc-uuid',
        localSubscriptionId: 'sub-uuid',
        stripeSubscriptionId: 'sub_stripe',
        status: BillingSubscriptionStatus.ACTIVE,
      };

      // The @OnEvent decorator is tested by calling the method directly
      await service.handleSubscriptionCreated(payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          subscriptionId: 'sub-uuid',
          previousStatus: null,
          newStatus: BillingSubscriptionStatus.ACTIVE,
          reason: `event: ${BILLING_EVENTS.SUBSCRIPTION_CREATED}`,
        }),
      );
    });

    it('should record history on SUBSCRIPTION_UPDATED event', async () => {
      repo.save.mockResolvedValueOnce(mockHistory());

      const payload = {
        userId: 2,
        billingCustomerId: 'bc-uuid-2',
        localSubscriptionId: 'sub-uuid-2',
        stripeSubscriptionId: 'sub_stripe_2',
        status: BillingSubscriptionStatus.PAST_DUE,
      };

      await service.handleSubscriptionUpdated(payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          subscriptionId: 'sub-uuid-2',
          newStatus: BillingSubscriptionStatus.PAST_DUE,
          reason: `event: ${BILLING_EVENTS.SUBSCRIPTION_UPDATED}`,
        }),
      );
    });

    it('should record CANCELED on SUBSCRIPTION_CANCELED event', async () => {
      repo.save.mockResolvedValueOnce(mockHistory());

      const payload = {
        userId: 3,
        billingCustomerId: 'bc-uuid-3',
        localSubscriptionId: 'sub-uuid-3',
        stripeSubscriptionId: 'sub_stripe_3',
      };

      await service.handleSubscriptionCanceled(payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 3,
          subscriptionId: 'sub-uuid-3',
          newStatus: BillingSubscriptionStatus.CANCELED,
          reason: `event: ${BILLING_EVENTS.SUBSCRIPTION_CANCELED}`,
        }),
      );
    });
  });
});
