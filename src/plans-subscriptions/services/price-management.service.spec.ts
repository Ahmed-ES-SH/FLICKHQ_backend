import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import {
  BillingPriceType,
  BillingRecurringInterval,
} from '../../billing/common/billing.enums';
import { PriceManagementService } from './price-management.service';
import { PlanManagementService } from './plan-management.service';
import {
  CreatePriceDto,
  PriceType,
  PriceInterval,
} from '../dto/create-price.dto';

interface RepoMock {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

const mockPrice = (overrides: Partial<BillingPrice> = {}): BillingPrice => ({
  id: 'price-uuid-1',
  planId: 'plan-uuid-1',
  stripePriceId: 'price_stripe_1',
  stripeProductId: 'prod_1',
  currency: 'usd',
  unitAmount: 1999,
  type: BillingPriceType.RECURRING,
  interval: BillingRecurringInterval.MONTH,
  trialPeriodDays: null,
  active: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('PriceManagementService', () => {
  let service: PriceManagementService;
  let priceRepo: RepoMock;
  let planManagementMock: { getPlan: jest.Mock };

  beforeEach(async () => {
    priceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto as BillingPrice),
      save: jest.fn((price) => Promise.resolve(price as BillingPrice)),
    };

    planManagementMock = {
      getPlan: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceManagementService,
        { provide: getRepositoryToken(BillingPrice), useValue: priceRepo },
        { provide: PlanManagementService, useValue: planManagementMock },
      ],
    }).compile();

    service = module.get<PriceManagementService>(PriceManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addPrice', () => {
    it('should create a recurring price with interval', async () => {
      planManagementMock.getPlan.mockResolvedValueOnce({ id: 'plan-uuid-1' });

      const dto: CreatePriceDto = {
        stripePriceId: 'price_stripe_2',
        currency: 'usd',
        unitAmount: 4999,
        type: PriceType.RECURRING,
        interval: PriceInterval.MONTH,
      };

      priceRepo.save.mockResolvedValueOnce(
        mockPrice({
          stripePriceId: 'price_stripe_2',
          unitAmount: 4999,
          type: BillingPriceType.RECURRING,
          interval: BillingRecurringInterval.MONTH,
        }),
      );

      const result = await service.addPrice('plan-uuid-1', dto);

      expect(planManagementMock.getPlan).toHaveBeenCalledWith('plan-uuid-1');
      expect(priceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-uuid-1',
          stripePriceId: 'price_stripe_2',
          unitAmount: 4999,
          type: BillingPriceType.RECURRING,
          interval: BillingRecurringInterval.MONTH,
        }),
      );
      expect(result.stripePriceId).toBe('price_stripe_2');
    });

    it('should create a one-time price without interval', async () => {
      planManagementMock.getPlan.mockResolvedValueOnce({ id: 'plan-uuid-1' });

      const dto: CreatePriceDto = {
        stripePriceId: 'price_ot_1',
        currency: 'usd',
        unitAmount: 9999,
        type: PriceType.ONE_TIME,
      };

      priceRepo.save.mockResolvedValueOnce(
        mockPrice({
          stripePriceId: 'price_ot_1',
          unitAmount: 9999,
          type: BillingPriceType.ONE_TIME,
          interval: null,
        }),
      );

      const result = await service.addPrice('plan-uuid-1', dto);

      expect(priceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-uuid-1',
          type: BillingPriceType.ONE_TIME,
          interval: null,
        }),
      );
      expect(result.type).toBe(PriceType.ONE_TIME);
    });

    it('should normalize currency to lowercase', async () => {
      planManagementMock.getPlan.mockResolvedValueOnce({ id: 'plan-uuid-1' });

      const dto: CreatePriceDto = {
        stripePriceId: 'price_usd',
        currency: 'USD',
        unitAmount: 1000,
        type: PriceType.ONE_TIME,
      };

      priceRepo.save.mockResolvedValueOnce(mockPrice({ currency: 'usd' }));

      const result = await service.addPrice('plan-uuid-1', dto);
      expect(result.currency).toBe('usd');
    });

    it('should apply trial period days', async () => {
      planManagementMock.getPlan.mockResolvedValueOnce({ id: 'plan-uuid-1' });

      const dto: CreatePriceDto = {
        stripePriceId: 'price_trial',
        currency: 'usd',
        unitAmount: 1000,
        type: PriceType.RECURRING,
        interval: PriceInterval.MONTH,
        trialPeriodDays: 14,
      };

      priceRepo.save.mockResolvedValueOnce(mockPrice({ trialPeriodDays: 14 }));

      const result = await service.addPrice('plan-uuid-1', dto);
      expect(result.trialPeriodDays).toBe(14);
    });

    it('should set active default to true', async () => {
      planManagementMock.getPlan.mockResolvedValueOnce({ id: 'plan-uuid-1' });

      const dto: CreatePriceDto = {
        stripePriceId: 'price_active',
        currency: 'usd',
        unitAmount: 1000,
        type: PriceType.RECURRING,
        interval: PriceInterval.MONTH,
      };

      priceRepo.save.mockResolvedValueOnce(mockPrice({ active: true }));

      const result = await service.addPrice('plan-uuid-1', dto);
      expect(result.active).toBe(true);
    });
  });

  describe('getPrice', () => {
    it('should return a price with plan relation', async () => {
      priceRepo.findOne.mockResolvedValueOnce(
        mockPrice({ stripeProductId: 'prod_1' }),
      );

      const result = await service.getPrice('price-uuid-1');

      expect(priceRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'price-uuid-1' },
        relations: ['plan'],
      });
      expect(result.id).toBe('price-uuid-1');
    });

    it('should throw NotFoundException for missing price', async () => {
      priceRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getPrice('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listPricesForPlan', () => {
    it('should return all prices for a plan ordered by unitAmount', async () => {
      const prices = [
        mockPrice({ id: 'p1', unitAmount: 500 }),
        mockPrice({ id: 'p2', unitAmount: 1000 }),
      ];
      priceRepo.find.mockResolvedValueOnce(prices);

      const result = await service.listPricesForPlan('plan-uuid-1');

      expect(result).toHaveLength(2);
      expect(priceRepo.find).toHaveBeenCalledWith({
        where: { planId: 'plan-uuid-1' },
        order: { unitAmount: 'ASC' },
      });
    });
  });

  describe('deactivatePrice', () => {
    it('should set active to false', async () => {
      priceRepo.findOne.mockResolvedValueOnce(mockPrice({ active: true }));
      priceRepo.save.mockResolvedValueOnce(mockPrice({ active: false }));

      const result = await service.deactivatePrice('price-uuid-1');

      expect(result.active).toBe(false);
    });

    it('should throw NotFoundException for missing price', async () => {
      priceRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.deactivatePrice('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
