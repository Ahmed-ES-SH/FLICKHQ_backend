import { Test, TestingModule } from '@nestjs/testing';
import { AdminPlansController } from './admin-plans.controller';
import { PlanService } from '../services/plan.service';
import { PlanStatus, PriceType } from '../common/subscription.enums';

describe('AdminPlansController', () => {
  let controller: AdminPlansController;
  let planService: jest.Mocked<PlanService>;

  const mockPlanResponse = {
    id: 'plan-uuid-1',
    code: 'pro',
    name: 'Pro Plan',
    description: null,
    status: PlanStatus.ACTIVE,
    features: [],
    displayOrder: 0,
    icon: null,
    highlight: false,
    prices: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPriceResponse = {
    id: 'price-uuid-1',
    planId: 'plan-uuid-1',
    currency: 'usd',
    unitAmount: 999,
    type: PriceType.RECURRING,
    interval: 'month' as any,
    trialPeriodDays: null,
    active: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    planService = {
      createPlan: jest.fn(),
      listPlans: jest.fn(),
      getPlan: jest.fn(),
      updatePlan: jest.fn(),
      archivePlan: jest.fn(),
      addPrice: jest.fn(),
      listPricesForPlan: jest.fn(),
      deactivatePrice: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminPlansController],
      providers: [
        {
          provide: PlanService,
          useValue: planService,
        },
      ],
    }).compile();

    controller = module.get<AdminPlansController>(AdminPlansController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createPlan', () => {
    it('should create a plan', async () => {
      planService.createPlan.mockResolvedValue(mockPlanResponse);
      const dto = { code: 'pro', name: 'Pro Plan' };

      const result = await controller.createPlan(dto as any);

      expect(result.id).toBe('plan-uuid-1');
      expect(planService.createPlan).toHaveBeenCalledWith(dto);
    });
  });

  describe('listPlans', () => {
    it('should list plans with optional status filter', async () => {
      planService.listPlans.mockResolvedValue([mockPlanResponse]);

      const result = await controller.listPlans(PlanStatus.ACTIVE);

      expect(result).toHaveLength(1);
      expect(planService.listPlans).toHaveBeenCalledWith(PlanStatus.ACTIVE);
    });

    it('should list all plans when no status filter', async () => {
      planService.listPlans.mockResolvedValue([mockPlanResponse]);

      const result = await controller.listPlans();

      expect(result).toHaveLength(1);
      expect(planService.listPlans).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getPlan', () => {
    it('should get a plan by id', async () => {
      planService.getPlan.mockResolvedValue(mockPlanResponse);

      const result = await controller.getPlan('plan-uuid-1');

      expect(result.id).toBe('plan-uuid-1');
      expect(planService.getPlan).toHaveBeenCalledWith('plan-uuid-1');
    });
  });

  describe('updatePlan', () => {
    it('should update a plan', async () => {
      planService.updatePlan.mockResolvedValue({
        ...mockPlanResponse,
        name: 'Updated',
      });
      const dto = { name: 'Updated' };

      const result = await controller.updatePlan('plan-uuid-1', dto as any);

      expect(result.name).toBe('Updated');
      expect(planService.updatePlan).toHaveBeenCalledWith('plan-uuid-1', dto);
    });
  });

  describe('archivePlan', () => {
    it('should archive a plan', async () => {
      planService.archivePlan.mockResolvedValue({
        ...mockPlanResponse,
        status: PlanStatus.ARCHIVED,
      });

      const result = await controller.archivePlan('plan-uuid-1');

      expect(result.status).toBe(PlanStatus.ARCHIVED);
      expect(planService.archivePlan).toHaveBeenCalledWith('plan-uuid-1');
    });
  });

  describe('addPrice', () => {
    it('should add a price to a plan', async () => {
      planService.addPrice.mockResolvedValue(mockPriceResponse);
      const dto = {
        currency: 'usd',
        unitAmount: 999,
        type: PriceType.RECURRING,
      };

      const result = await controller.addPrice('plan-uuid-1', dto as any);

      expect(result.unitAmount).toBe(999);
      expect(planService.addPrice).toHaveBeenCalledWith('plan-uuid-1', dto);
    });
  });

  describe('listPrices', () => {
    it('should list prices for a plan', async () => {
      planService.listPricesForPlan.mockResolvedValue([mockPriceResponse]);

      const result = await controller.listPrices('plan-uuid-1');

      expect(result).toHaveLength(1);
      expect(planService.listPricesForPlan).toHaveBeenCalledWith('plan-uuid-1');
    });
  });

  describe('deactivatePrice', () => {
    it('should deactivate a price', async () => {
      planService.deactivatePrice.mockResolvedValue({
        ...mockPriceResponse,
        active: false,
      });

      const result = await controller.deactivatePrice('price-uuid-1');

      expect(result.active).toBe(false);
      expect(planService.deactivatePrice).toHaveBeenCalledWith('price-uuid-1');
    });
  });
});
