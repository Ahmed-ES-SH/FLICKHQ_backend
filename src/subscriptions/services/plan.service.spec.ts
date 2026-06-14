import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlanService } from './plan.service';
import { Plan } from '../entities/plan.entity';
import { Price } from '../entities/price.entity';
import { PlanStatus, PriceType } from '../common/subscription.enums';

describe('PlanService', () => {
  let service: PlanService;
  let planRepo: jest.Mocked<Repository<Plan>>;
  let priceRepo: jest.Mocked<Repository<Price>>;

  const mockPlan: Plan = {
    id: 'plan-uuid-1',
    code: 'pro',
    name: 'Pro Plan',
    description: 'The pro plan',
    status: PlanStatus.ACTIVE,
    features: ['feature-a'],
    displayOrder: 1,
    icon: 'star',
    highlight: true,
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPrice: Price = {
    id: 'price-uuid-1',
    planId: 'plan-uuid-1',
    currency: 'usd',
    unitAmount: 999,
    type: PriceType.RECURRING,
    interval: 'month' as any,
    trialPeriodDays: 7,
    active: true,
    stripePriceId: 'price_stripe_123',
    stripeProductId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Price),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PlanService>(PlanService);
    planRepo = module.get(getRepositoryToken(Plan));
    priceRepo = module.get(getRepositoryToken(Price));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPlan', () => {
    it('should create and return a plan', async () => {
      planRepo.create.mockReturnValue(mockPlan);
      planRepo.save.mockResolvedValue(mockPlan);
      priceRepo.find.mockResolvedValue([]);

      const result = await service.createPlan({
        code: 'pro',
        name: 'Pro Plan',
      });

      expect(planRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'pro', name: 'Pro Plan' }),
      );
      expect(planRepo.save).toHaveBeenCalledWith(mockPlan);
      expect(result.id).toBe('plan-uuid-1');
      expect(result.code).toBe('pro');
    });
  });

  describe('updatePlan', () => {
    it('should update a plan', async () => {
      const updated = { ...mockPlan, name: 'Updated Pro' };
      planRepo.findOne.mockResolvedValue(mockPlan);
      planRepo.save.mockResolvedValue(updated);
      priceRepo.find.mockResolvedValue([]);

      const result = await service.updatePlan('plan-uuid-1', {
        name: 'Updated Pro',
      });

      expect(result.name).toBe('Updated Pro');
    });

    it('should throw NotFoundException if plan not found', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updatePlan('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if plan is archived', async () => {
      planRepo.findOne.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.ARCHIVED,
      });

      await expect(
        service.updatePlan('plan-uuid-1', { name: 'Test' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('archivePlan', () => {
    it('should archive a plan', async () => {
      const archived = { ...mockPlan, status: PlanStatus.ARCHIVED };
      planRepo.findOne.mockResolvedValue(mockPlan);
      planRepo.save.mockResolvedValue(archived);
      priceRepo.find.mockResolvedValue([]);

      const result = await service.archivePlan('plan-uuid-1');

      expect(result.status).toBe(PlanStatus.ARCHIVED);
    });

    it('should throw NotFoundException if plan not found', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(service.archivePlan('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPlan', () => {
    it('should return plan with prices', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      priceRepo.find.mockResolvedValue([mockPrice]);

      const result = await service.getPlan('plan-uuid-1');

      expect(result.id).toBe('plan-uuid-1');
      expect(result.prices).toHaveLength(1);
    });

    it('should throw NotFoundException if plan not found', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(service.getPlan('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listPlans', () => {
    it('should return all plans with prices', async () => {
      planRepo.find.mockResolvedValue([mockPlan]);
      priceRepo.find.mockResolvedValue([mockPrice]);

      const result = await service.listPlans();

      expect(result).toHaveLength(1);
      expect(result[0]!.prices).toHaveLength(1);
    });

    it('should filter by status', async () => {
      planRepo.find.mockResolvedValue([mockPlan]);
      priceRepo.find.mockResolvedValue([]);

      await service.listPlans(PlanStatus.ACTIVE);

      expect(planRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: PlanStatus.ACTIVE },
        }),
      );
    });

    it('should return empty array when no plans', async () => {
      planRepo.find.mockResolvedValue([]);

      const result = await service.listPlans();

      expect(result).toEqual([]);
    });
  });

  describe('listPublicPlans', () => {
    it('should only return active plans with active prices', async () => {
      planRepo.find.mockResolvedValue([mockPlan]);
      priceRepo.find.mockResolvedValue([mockPrice]);

      const result = await service.listPublicPlans();

      expect(result).toHaveLength(1);
      expect(planRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: PlanStatus.ACTIVE },
        }),
      );
      expect(priceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it('should exclude plans with no active prices', async () => {
      planRepo.find.mockResolvedValue([mockPlan]);
      priceRepo.find.mockResolvedValue([]);

      const result = await service.listPublicPlans();

      expect(result).toHaveLength(0);
    });
  });

  describe('addPrice', () => {
    it('should add a price to a plan', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      priceRepo.create.mockReturnValue(mockPrice);
      priceRepo.save.mockResolvedValue(mockPrice);

      const result = await service.addPrice('plan-uuid-1', {
        currency: 'usd',
        unitAmount: 999,
        type: PriceType.RECURRING,
        interval: 'month' as any,
        trialPeriodDays: 7,
      });

      expect(result.unitAmount).toBe(999);
    });

    it('should throw if plan not found', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addPrice('nonexistent', {
          currency: 'usd',
          unitAmount: 999,
          type: PriceType.ONE_TIME,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listPricesForPlan', () => {
    it('should list prices for a plan', async () => {
      priceRepo.find.mockResolvedValue([mockPrice]);

      const result = await service.listPricesForPlan('plan-uuid-1');

      expect(result).toHaveLength(1);
    });
  });

  describe('deactivatePrice', () => {
    it('should deactivate a price', async () => {
      const deactivated = { ...mockPrice, active: false };
      priceRepo.findOne.mockResolvedValue(mockPrice);
      priceRepo.save.mockResolvedValue(deactivated);

      const result = await service.deactivatePrice('price-uuid-1');

      expect(result.active).toBe(false);
    });

    it('should throw if price not found', async () => {
      priceRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivatePrice('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
