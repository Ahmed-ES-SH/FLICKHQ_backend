/**
 * HTTP-layer tests for the admin plans controller. Verifies
 * that DTOs are passed through to the management services and
 * that the response shape is correctly assembled.
 *
 * Guards are stubbed via jest.mock to avoid loading the auth
 * module transitively (which pulls in UserService and its
 * `src/helpers/paginate.helper` path-alias import that the
 * unit-test Jest config does not resolve).
 */

jest.mock('../../auth/guards/auth.guard', () => ({
  AuthGuard: class AuthGuard {
    canActivate(): boolean {
      return true;
    }
  },
}));

jest.mock('../../auth/guards/roles.guard', () => ({
  RolesGuard: class RolesGuard {
    canActivate(): boolean {
      return true;
    }
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AdminPlansController } from './admin-plans.controller';
import { PlanManagementService } from '../services/plan-management.service';
import { PriceManagementService } from '../services/price-management.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import {
  CreatePriceDto,
  PriceType,
  PriceInterval,
} from '../dto/create-price.dto';
import { BillingPlanStatus } from '../../billing/common/billing.enums';

describe('AdminPlansController', () => {
  let controller: AdminPlansController;
  let planManagement: jest.Mocked<PlanManagementService>;
  let priceManagement: jest.Mocked<PriceManagementService>;

  beforeEach(async () => {
    planManagement = {
      createPlan: jest.fn(),
      updatePlan: jest.fn(),
      archivePlan: jest.fn(),
      getPlan: jest.fn(),
      listPlans: jest.fn(),
    } as any;

    priceManagement = {
      addPrice: jest.fn(),
      deactivatePrice: jest.fn(),
      listPricesForPlan: jest.fn(),
      getPrice: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminPlansController],
      providers: [
        { provide: PlanManagementService, useValue: planManagement },
        { provide: PriceManagementService, useValue: priceManagement },
      ],
    }).compile();

    controller = module.get<AdminPlansController>(AdminPlansController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /admin/plans', () => {
    it('should create a plan and return mutation result', async () => {
      const dto: CreatePlanDto = { code: 'pro', name: 'Pro Plan' };
      planManagement.createPlan.mockResolvedValueOnce({
        id: 'p1',
        code: 'pro',
        name: 'Pro Plan',
        prices: [],
      } as any);

      const result = await controller.createPlan(dto);

      expect(planManagement.createPlan).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        plan: expect.objectContaining({ code: 'pro' }),
      });
    });
  });

  describe('GET /admin/plans', () => {
    it('should list plans with optional status filter', async () => {
      planManagement.listPlans.mockResolvedValueOnce([]);

      const result = await controller.listPlans(BillingPlanStatus.ACTIVE);

      expect(planManagement.listPlans).toHaveBeenCalledWith(
        BillingPlanStatus.ACTIVE,
      );
      expect(result).toEqual([]);
    });

    it('should list all plans when no status provided', async () => {
      planManagement.listPlans.mockResolvedValueOnce([]);

      const result = await controller.listPlans(undefined);

      expect(planManagement.listPlans).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /admin/plans/:id', () => {
    it('should return a plan by id', async () => {
      planManagement.getPlan.mockResolvedValueOnce({
        id: 'p1',
        code: 'pro',
      } as any);

      const result = await controller.getPlan('plan-uuid');

      expect(planManagement.getPlan).toHaveBeenCalledWith('plan-uuid');
      expect(result.code).toBe('pro');
    });
  });

  describe('PATCH /admin/plans/:id', () => {
    it('should update a plan', async () => {
      const dto: UpdatePlanDto = { name: 'Updated' };
      planManagement.updatePlan.mockResolvedValueOnce({
        id: 'p1',
        name: 'Updated',
        prices: [],
      } as any);

      const result = await controller.updatePlan('plan-uuid', dto);

      expect(planManagement.updatePlan).toHaveBeenCalledWith('plan-uuid', dto);
      expect(result.plan.name).toBe('Updated');
    });
  });

  describe('POST /admin/plans/:id/archive', () => {
    it('should archive a plan', async () => {
      planManagement.archivePlan.mockResolvedValueOnce({
        id: 'p1',
        status: BillingPlanStatus.ARCHIVED,
        prices: [],
      } as any);

      const result = await controller.archivePlan('plan-uuid');

      expect(planManagement.archivePlan).toHaveBeenCalledWith('plan-uuid');
      expect(result.plan.status).toBe(BillingPlanStatus.ARCHIVED);
    });
  });

  describe('POST /admin/plans/:id/prices', () => {
    it('should add a price to a plan', async () => {
      const dto: CreatePriceDto = {
        stripePriceId: 'price_1',
        currency: 'usd',
        unitAmount: 999,
        type: PriceType.RECURRING,
        interval: PriceInterval.MONTH,
      };
      priceManagement.addPrice.mockResolvedValueOnce({
        id: 'pr1',
        stripePriceId: 'price_1',
      } as any);

      const result = await controller.addPrice('plan-uuid', dto);

      expect(priceManagement.addPrice).toHaveBeenCalledWith('plan-uuid', dto);
      expect(result.stripePriceId).toBe('price_1');
    });
  });

  describe('GET /admin/plans/:id/prices', () => {
    it('should list prices for a plan', async () => {
      priceManagement.listPricesForPlan.mockResolvedValueOnce([]);

      const result = await controller.listPrices('plan-uuid');

      expect(priceManagement.listPricesForPlan).toHaveBeenCalledWith(
        'plan-uuid',
      );
      expect(result).toEqual([]);
    });
  });

  describe('PATCH /admin/prices/:id', () => {
    it('should deactivate a price', async () => {
      priceManagement.deactivatePrice.mockResolvedValueOnce({
        id: 'pr1',
        active: false,
      } as any);

      const result = await controller.deactivatePrice('price-uuid');

      expect(priceManagement.deactivatePrice).toHaveBeenCalledWith(
        'price-uuid',
      );
      expect(result.active).toBe(false);
    });
  });
});
