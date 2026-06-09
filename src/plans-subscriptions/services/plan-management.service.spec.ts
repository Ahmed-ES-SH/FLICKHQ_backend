import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { BillingPlan } from '../../billing/entities/billing-plan.entity';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import { BillingCatalogService } from '../../billing/services/billing-catalog.service';
import { BillingPlanStatus } from '../../billing/common/billing.enums';
import { PlanManagementService } from './plan-management.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';

interface RepoMock {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

const mockPlan = (overrides: Partial<BillingPlan> = {}): BillingPlan => ({
  id: 'plan-uuid-1',
  code: 'pro_monthly',
  name: 'Pro Monthly',
  description: null,
  status: BillingPlanStatus.ACTIVE,
  features: ['premium_reports'],
  displayOrder: 1,
  icon: null,
  highlight: false,
  metadata: {},
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const mockPrice = (overrides: Partial<BillingPrice> = {}): BillingPrice => ({
  id: 'price-uuid-1',
  planId: 'plan-uuid-1',
  stripePriceId: 'price_stripe_1',
  stripeProductId: 'prod_1',
  currency: 'usd',
  unitAmount: 1999,
  type: 'recurring' as any,
  interval: 'month' as any,
  trialPeriodDays: null,
  active: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('PlanManagementService', () => {
  let service: PlanManagementService;
  let planRepo: RepoMock;
  let priceRepo: RepoMock;

  beforeEach(async () => {
    planRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ id: 'plan-uuid-1', ...dto }) as BillingPlan),
      save: jest.fn((plan) => Promise.resolve(plan as BillingPlan)),
    };
    priceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto as BillingPrice),
      save: jest.fn((price) => Promise.resolve(price as BillingPrice)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanManagementService,
        { provide: getRepositoryToken(BillingPlan), useValue: planRepo },
        { provide: getRepositoryToken(BillingPrice), useValue: priceRepo },
        { provide: BillingCatalogService, useValue: {} },
      ],
    }).compile();

    service = module.get<PlanManagementService>(PlanManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPlan', () => {
    it('should create a plan with display fields', async () => {
      const dto: CreatePlanDto = {
        code: 'pro_monthly',
        name: 'Pro Monthly',
        description: 'A pro plan',
        features: ['feature_a'],
        displayOrder: 2,
        icon: 'https://example.com/icon.png',
        highlight: true,
        metadata: { key: 'val' },
      };

      planRepo.save.mockResolvedValueOnce(
        mockPlan({
          code: 'pro_monthly',
          name: 'Pro Monthly',
          description: 'A pro plan',
          features: ['feature_a'],
          displayOrder: 2,
          icon: 'https://example.com/icon.png',
          highlight: true,
          metadata: { key: 'val' },
        }),
      );
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.createPlan(dto);

      expect(planRepo.create).toHaveBeenCalledWith({
        code: 'pro_monthly',
        name: 'Pro Monthly',
        description: 'A pro plan',
        features: ['feature_a'],
        displayOrder: 2,
        icon: 'https://example.com/icon.png',
        highlight: true,
        metadata: { key: 'val' },
      });
      expect(result.code).toBe('pro_monthly');
      expect(result.displayOrder).toBe(2);
      expect(result.highlight).toBe(true);
      expect(result.icon).toBe('https://example.com/icon.png');
      expect(result.prices).toEqual([]);
    });

    it('should apply defaults when optional fields omitted', async () => {
      const dto: CreatePlanDto = {
        code: 'basic',
        name: 'Basic',
      };

      planRepo.save.mockResolvedValueOnce(
        mockPlan({
          code: 'basic',
          name: 'Basic',
          displayOrder: 0,
          features: [],
        }),
      );
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.createPlan(dto);

      expect(result.displayOrder).toBe(0);
      expect(result.highlight).toBe(false);
      expect(result.icon).toBeNull();
      expect(result.features).toEqual([]);
    });
  });

  describe('updatePlan', () => {
    it('should update plan fields partially', async () => {
      const existing = mockPlan({ name: 'Old Name', displayOrder: 0 });
      planRepo.findOne.mockResolvedValueOnce(existing);

      const dto: UpdatePlanDto = { name: 'New Name', displayOrder: 5 };
      planRepo.save.mockResolvedValueOnce(
        mockPlan({ name: 'New Name', displayOrder: 5 }),
      );
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.updatePlan('plan-uuid-1', dto);

      expect(result.name).toBe('New Name');
      expect(result.displayOrder).toBe(5);
    });

    it('should throw NotFoundException when plan does not exist', async () => {
      planRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.updatePlan('nonexistent', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archivePlan', () => {
    it('should set plan status to archived', async () => {
      const existing = mockPlan({ status: BillingPlanStatus.ACTIVE });
      planRepo.findOne.mockResolvedValueOnce(existing);
      planRepo.save.mockResolvedValueOnce(
        mockPlan({ status: BillingPlanStatus.ARCHIVED }),
      );
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.archivePlan('plan-uuid-1');

      expect(result.status).toBe(BillingPlanStatus.ARCHIVED);
    });

    it('should throw NotFoundException for missing plan', async () => {
      planRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.archivePlan('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPlan', () => {
    it('should return plan with prices', async () => {
      const existing = mockPlan();
      planRepo.findOne.mockResolvedValueOnce(existing);
      priceRepo.find.mockResolvedValueOnce([mockPrice()]);

      const result = await service.getPlan('plan-uuid-1');

      expect(result.id).toBe('plan-uuid-1');
      expect(result.prices).toHaveLength(1);
      expect(result.prices[0]!.stripePriceId).toBe('price_stripe_1');
    });

    it('should throw NotFoundException for missing plan', async () => {
      planRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getPlan('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listPlans', () => {
    it('should return all plans ordered by displayOrder', async () => {
      const plans = [
        mockPlan({ id: 'p1', code: 'basic', displayOrder: 2 }),
        mockPlan({ id: 'p2', code: 'pro', displayOrder: 1 }),
      ];
      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.listPlans();

      expect(result).toHaveLength(2);
      expect(result[0]!.code).toBe('basic');
      expect(result[1]!.code).toBe('pro');
    });

    it('should filter by status when provided', async () => {
      planRepo.find.mockResolvedValueOnce([]);
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.listPlans(BillingPlanStatus.ACTIVE);

      expect(planRepo.find).toHaveBeenCalledWith({
        where: { status: BillingPlanStatus.ACTIVE },
        order: { displayOrder: 'ASC', createdAt: 'ASC' },
      });
      expect(result).toEqual([]);
    });

    it('should return empty array if no plans', async () => {
      planRepo.find.mockResolvedValueOnce([]);

      const result = await service.listPlans();

      expect(result).toEqual([]);
    });

    it('should batch-load prices for all plans', async () => {
      const plans = [
        mockPlan({ id: 'p1', code: 'basic' }),
        mockPlan({ id: 'p2', code: 'pro' }),
      ];
      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce([
        mockPrice({ id: 'pr1', planId: 'p1' }),
        mockPrice({ id: 'pr2', planId: 'p2' }),
      ]);

      const result = await service.listPlans();

      expect(result[0]!.prices).toHaveLength(1);
      expect(result[1]!.prices).toHaveLength(1);
      expect(priceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            planId: expect.objectContaining({
              _value: expect.arrayContaining(['p1', 'p2']),
            }),
          },
        }),
      );
    });
  });
});
