import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { BillingSubscription } from '../../billing/entities/billing-subscription.entity';
import { BillingPayment } from '../../billing/entities/billing-payment.entity';
import { BillingInvoice } from '../../billing/entities/billing-invoice.entity';
import { BillingTransaction } from '../../billing/entities/billing-transaction.entity';
import {
  BillingSubscriptionStatus,
  BillingPaymentStatus,
} from '../../billing/common/billing.enums';
import { UserBillingHistoryService } from './user-billing-history.service';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

interface MockRepo {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
}

const mockSubscription = (overrides: Record<string, any> = {}) => ({
  id: 'sub-uuid-1',
  userId: 1,
  status: BillingSubscriptionStatus.ACTIVE,
  plan: { name: 'Pro Plan' },
  price: { currency: 'usd', unitAmount: 1999, interval: 'month' },
  currentPeriodStart: new Date('2025-01-01T00:00:00Z'),
  currentPeriodEnd: new Date('2025-02-01T00:00:00Z'),
  trialEnd: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const mockPayment = (overrides: Record<string, any> = {}) => ({
  id: 'pay-uuid-1',
  userId: 1,
  amount: 1999,
  amountRefunded: 0,
  currency: 'usd',
  status: BillingPaymentStatus.SUCCEEDED,
  description: 'Pro Plan - Monthly',
  stripePaymentIntentId: 'pi_123',
  subscriptionId: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const mockTransaction = (overrides: Record<string, any> = {}) => ({
  id: 'tx-uuid-1',
  paymentId: 'pay-uuid-1',
  type: 'charge',
  amount: 1999,
  ...overrides,
});

const mockInvoice = (overrides: Record<string, any> = {}) => ({
  id: 'inv-uuid-1',
  userId: 1,
  subscriptionId: 'sub-uuid-1',
  number: 'INV-001',
  stripePaymentIntentId: 'pi_123',
  ...overrides,
});

describe('UserBillingHistoryService', () => {
  let service: UserBillingHistoryService;
  let subRepo: MockRepo;
  let paymentRepo: MockRepo;
  let invoiceRepo: MockRepo;
  let transactionRepo: MockRepo;

  beforeEach(async () => {
    subRepo = { findOne: jest.fn(), find: jest.fn(), findAndCount: jest.fn() };
    paymentRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
    };
    invoiceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
    };
    transactionRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserBillingHistoryService,
        { provide: getRepositoryToken(BillingSubscription), useValue: subRepo },
        { provide: getRepositoryToken(BillingPayment), useValue: paymentRepo },
        { provide: getRepositoryToken(BillingInvoice), useValue: invoiceRepo },
        {
          provide: getRepositoryToken(BillingTransaction),
          useValue: transactionRepo,
        },
      ],
    }).compile();

    service = module.get<UserBillingHistoryService>(UserBillingHistoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentSubscription', () => {
    it('should return active subscription for user', async () => {
      subRepo.findOne.mockResolvedValueOnce(mockSubscription());

      const result = await service.getCurrentSubscription(1);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(BillingSubscriptionStatus.ACTIVE);
      expect(result!.planName).toBe('Pro Plan');
      expect(subRepo.findOne).toHaveBeenCalledWith({
        where: [
          { userId: 1, status: BillingSubscriptionStatus.ACTIVE },
          { userId: 1, status: BillingSubscriptionStatus.TRIALING },
          { userId: 1, status: BillingSubscriptionStatus.PAST_DUE },
        ],
        relations: ['plan', 'price'],
        order: { createdAt: 'DESC' },
      });
    });

    it('should return null if no active subscription', async () => {
      subRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.getCurrentSubscription(1);

      expect(result).toBeNull();
    });
  });

  describe('getUserSubscriptionHistory', () => {
    it('should return paginated subscription history', async () => {
      const subs = [
        mockSubscription({
          id: 's1',
          status: BillingSubscriptionStatus.ACTIVE,
        }),
        mockSubscription({
          id: 's2',
          status: BillingSubscriptionStatus.CANCELED,
        }),
      ];
      subRepo.findAndCount.mockResolvedValueOnce([subs, 2]);

      const pagination: PaginationQueryDto = { page: 1, limit: 20 };
      const result = await service.getUserSubscriptionHistory(1, pagination);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items[0]!.planName).toBe('Pro Plan');
    });

    it('should apply pagination skip correctly', async () => {
      subRepo.findAndCount.mockResolvedValueOnce([[], 5]);

      await service.getUserSubscriptionHistory(1, { page: 2, limit: 3 });

      expect(subRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 3, take: 3 }),
      );
    });
  });

  describe('getUserPaymentHistory', () => {
    it('should return paginated payment history', async () => {
      const payments = [mockPayment({ id: 'p1' }), mockPayment({ id: 'p2' })];
      paymentRepo.findAndCount.mockResolvedValueOnce([payments, 2]);
      transactionRepo.find.mockResolvedValueOnce([
        mockTransaction({ paymentId: 'p1', type: 'charge' }),
        mockTransaction({ paymentId: 'p2', type: 'charge' }),
      ]);
      invoiceRepo.find.mockResolvedValueOnce([
        mockInvoice({ stripePaymentIntentId: 'pi_123' }),
      ]);

      const pagination: PaginationQueryDto = { page: 1, limit: 20 };
      const result = await service.getUserPaymentHistory(1, pagination);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.items[0]!.transactionType).toBe('charge');
    });

    it('should identify refund transactions', async () => {
      const payment = mockPayment({ id: 'p1', amountRefunded: 500 });
      paymentRepo.findAndCount.mockResolvedValueOnce([[payment], 1]);
      transactionRepo.find.mockResolvedValueOnce([
        mockTransaction({ paymentId: 'p1', type: 'charge' }),
        mockTransaction({ paymentId: 'p1', type: 'refund', amount: 500 }),
      ]);
      invoiceRepo.find.mockResolvedValueOnce([]);

      const result = await service.getUserPaymentHistory(1, {
        page: 1,
        limit: 20,
      });

      expect(result.items[0]!.transactionType).toBe('refund');
    });

    it('should batch-fetch related data', async () => {
      const payments = [mockPayment({ id: 'p1' })];
      paymentRepo.findAndCount.mockResolvedValueOnce([payments, 1]);
      transactionRepo.find.mockResolvedValueOnce([]);
      invoiceRepo.find.mockResolvedValueOnce([]);

      await service.getUserPaymentHistory(1, { page: 1, limit: 20 });

      expect(transactionRepo.find).toHaveBeenCalledWith({
        where: { paymentId: expect.anything() },
      });
    });
  });

  describe('getPaymentDetail', () => {
    it('should return payment detail with invoice info', async () => {
      const payment = mockPayment({ id: 'pay-1' });
      paymentRepo.findOne.mockResolvedValueOnce(payment);
      transactionRepo.find.mockResolvedValueOnce([
        mockTransaction({ paymentId: 'pay-1', type: 'charge' }),
      ]);
      invoiceRepo.findOne.mockResolvedValueOnce(
        mockInvoice({ number: 'INV-001' }),
      );

      const result = await service.getPaymentDetail('pay-1', 1);

      expect(result).not.toBeNull();
      expect(result!.invoiceNumber).toBe('INV-001');
      expect(result!.transactionType).toBe('charge');
    });

    it('should return null for payment not owned by user', async () => {
      paymentRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.getPaymentDetail('pay-unknown', 1);

      expect(result).toBeNull();
    });
  });
});
