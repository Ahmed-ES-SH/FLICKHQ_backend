import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { BillingCatalogService } from './billing-catalog.service';
import { BillingPlan } from '../entities/billing-plan.entity';
import { BillingPrice } from '../entities/billing-price.entity';
import {
  BillingPlanStatus,
  BillingPriceType,
  BillingRecurringInterval,
} from '../common/billing.enums';

interface PlanRepoMock {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

interface PriceRepoMock {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

const samplePlan = (overrides: Partial<BillingPlan> = {}): BillingPlan => ({
  id: 'plan-1',
  code: 'pro_monthly',
  name: 'Pro Monthly',
  description: null,
  status: BillingPlanStatus.ACTIVE,
  features: ['premium_reports'],
  metadata: {},
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const samplePrice = (overrides: Partial<BillingPrice> = {}): BillingPrice => ({
  id: 'price-1',
  planId: 'plan-1',
  stripePriceId: 'price_stripe_1',
  stripeProductId: 'prod_stripe_1',
  currency: 'usd',
  unitAmount: 1999,
  type: BillingPriceType.RECURRING,
  interval: BillingRecurringInterval.MONTH,
  trialPeriodDays: null,
  active: true,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('BillingCatalogService', () => {
  let service: BillingCatalogService;
  let planRepo: PlanRepoMock;
  let priceRepo: PriceRepoMock;

  beforeEach(async () => {
    planRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto as BillingPlan),
      save: jest.fn((plan) => Promise.resolve(plan as BillingPlan)),
    };
    priceRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as BillingPrice),
      save: jest.fn((price) => Promise.resolve(price as BillingPrice)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingCatalogService,
        {
          provide: getRepositoryToken(BillingPlan),
          useValue: planRepo,
        },
        {
          provide: getRepositoryToken(BillingPrice),
          useValue: priceRepo,
        },
      ],
    }).compile();

    service = module.get(BillingCatalogService);
  });

  describe('createPlan', () => {
    it('persists a new plan and returns it', async () => {
      const result = await service.createPlan({
        code: 'pro_monthly',
        name: 'Pro Monthly',
      });
      expect(result.code).toBe('pro_monthly');
      expect(planRepo.save).toHaveBeenCalled();
    });

    it('translates a unique-violation on `code` into a ConflictException', async () => {
      const err = new QueryFailedError('INSERT', [], new Error('dup') as never);
      (err as unknown as { code: string }).code = '23505';
      (err as unknown as { detail: string }).detail = 'Key (code) ...';
      planRepo.save.mockRejectedValueOnce(err);
      await expect(
        service.createPlan({ code: 'pro_monthly', name: 'Pro' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updatePlan', () => {
    it('throws NotFoundException when the plan is missing', async () => {
      planRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updatePlan('missing', { name: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('applies the partial update and saves', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      const result = await service.updatePlan('plan-1', {
        name: 'New Name',
        features: ['a', 'b'],
      });
      expect(result.name).toBe('New Name');
      expect(result.features).toEqual(['a', 'b']);
    });
  });

  describe('archivePlan', () => {
    it('sets status=archived and saves', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      const result = await service.archivePlan('plan-1');
      expect(result.status).toBe(BillingPlanStatus.ARCHIVED);
    });
  });

  describe('addPrice', () => {
    it('throws when a recurring price has no interval', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      await expect(
        service.addPrice('plan-1', {
          stripePriceId: 'price_x',
          currency: 'USD',
          unitAmount: 100,
          type: BillingPriceType.RECURRING,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws when a one-time price has an interval', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      await expect(
        service.addPrice('plan-1', {
          stripePriceId: 'price_x',
          currency: 'USD',
          unitAmount: 100,
          type: BillingPriceType.ONE_TIME,
          interval: BillingRecurringInterval.MONTH,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('persists a recurring price with an interval', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      const result = await service.addPrice('plan-1', {
        stripePriceId: 'price_x',
        currency: 'USD',
        unitAmount: 999,
        type: BillingPriceType.RECURRING,
        interval: BillingRecurringInterval.MONTH,
      });
      expect(result.currency).toBe('usd');
      expect(result.interval).toBe(BillingRecurringInterval.MONTH);
    });

    it('translates a stripe_price_id unique-violation into a ConflictException', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      const err = new QueryFailedError('INSERT', [], new Error('dup') as never);
      (err as unknown as { code: string }).code = '23505';
      priceRepo.save.mockRejectedValueOnce(err);
      await expect(
        service.addPrice('plan-1', {
          stripePriceId: 'price_dup',
          currency: 'USD',
          unitAmount: 999,
          type: BillingPriceType.ONE_TIME,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getPlanWithPrices', () => {
    it('returns the plan with its prices', async () => {
      planRepo.findOne.mockResolvedValueOnce(samplePlan());
      priceRepo.find.mockResolvedValueOnce([samplePrice()]);
      const { plan, prices } = await service.getPlanWithPrices('plan-1');
      expect(plan.id).toBe('plan-1');
      expect(prices).toHaveLength(1);
    });

    it('throws NotFoundException when missing', async () => {
      planRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getPlanWithPrices('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findPriceByStripeId', () => {
    it('returns the matching price or null', async () => {
      priceRepo.findOne.mockResolvedValueOnce(samplePrice());
      await expect(
        service.findPriceByStripeId('price_stripe_1'),
      ).resolves.toMatchObject({
        stripePriceId: 'price_stripe_1',
      });
      priceRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findPriceByStripeId('nope')).resolves.toBeNull();
    });
  });

  describe('listAllPlans', () => {
    it('returns an empty list when no plans exist', async () => {
      planRepo.find.mockResolvedValueOnce([]);
      await expect(service.listAllPlans()).resolves.toEqual([]);
    });

    it('groups plans with their prices', async () => {
      planRepo.find.mockResolvedValueOnce([samplePlan()]);
      priceRepo.find.mockResolvedValueOnce([samplePrice()]);
      const result = await service.listAllPlans();
      expect(result).toHaveLength(1);
      expect(result[0].prices).toHaveLength(1);
    });
  });

  describe('listPublicPlans', () => {
    it('skips plans with no active prices', async () => {
      planRepo.find.mockResolvedValueOnce([samplePlan()]);
      priceRepo.find.mockResolvedValueOnce([]);
      const result = await service.listPublicPlans({});
      expect(result).toEqual([]);
    });

    it('returns only active plans and active prices', async () => {
      planRepo.find.mockResolvedValueOnce([samplePlan()]);
      priceRepo.find.mockResolvedValueOnce([
        samplePrice(),
        samplePrice({
          id: 'price-2',
          stripePriceId: 'price_stripe_2',
          active: false,
        }),
      ]);
      const result = await service.listPublicPlans({});
      expect(result).toHaveLength(1);
      expect(result[0].prices).toHaveLength(1);
    });

    it('filters by currency when requested', async () => {
      planRepo.find.mockResolvedValueOnce([samplePlan()]);
      priceRepo.find.mockResolvedValueOnce([
        samplePrice(),
        samplePrice({
          id: 'price-2',
          stripePriceId: 'price_stripe_2',
          currency: 'eur',
        }),
      ]);
      const result = await service.listPublicPlans({ currency: 'EUR' });
      expect(result[0].prices).toHaveLength(1);
      expect(result[0].prices[0].currency).toBe('eur');
    });
  });
});
