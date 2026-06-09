import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillingPlan } from '../../billing/entities/billing-plan.entity';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import { BillingPlanStatus } from '../../billing/common/billing.enums';
import { PlanDisplayService } from './plan-display.service';

interface RepoMock {
  find: jest.Mock;
}

const mockPlan = (overrides: Partial<BillingPlan> = {}): BillingPlan => ({
  id: 'plan-uuid-1',
  code: 'pro_monthly',
  name: 'Pro Monthly',
  description: 'A pro plan',
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

describe('PlanDisplayService', () => {
  let service: PlanDisplayService;
  let planRepo: RepoMock;
  let priceRepo: RepoMock;

  beforeEach(async () => {
    planRepo = { find: jest.fn() };
    priceRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanDisplayService,
        { provide: getRepositoryToken(BillingPlan), useValue: planRepo },
        { provide: getRepositoryToken(BillingPrice), useValue: priceRepo },
      ],
    }).compile();

    service = module.get<PlanDisplayService>(PlanDisplayService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listPublicPlans', () => {
    it('should return active plans with active prices ordered by displayOrder', async () => {
      const plans = [
        mockPlan({ id: 'p1', code: 'free', displayOrder: 1 }),
        mockPlan({ id: 'p2', code: 'pro', displayOrder: 2, highlight: true }),
      ];
      const prices = [
        mockPrice({ id: 'pr1', planId: 'p1', unitAmount: 0 }),
        mockPrice({ id: 'pr2', planId: 'p2', unitAmount: 1999 }),
      ];

      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce(prices);

      const result = await service.listPublicPlans();

      expect(planRepo.find).toHaveBeenCalledWith({
        where: { status: BillingPlanStatus.ACTIVE },
        order: { displayOrder: 'ASC', createdAt: 'ASC' },
      });
      expect(priceRepo.find).toHaveBeenCalledWith({
        where: { planId: expect.anything(), active: true },
        order: { unitAmount: 'ASC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.code).toBe('free');
      expect(result[1]!.code).toBe('pro');
      expect(result[1]!.highlight).toBe(true);
      expect(result[1]!.prices).toHaveLength(1);
      expect(result[1]!.prices[0]!.unitAmount).toBe(1999);
    });

    it('should filter out plans without active prices', async () => {
      const plans = [
        mockPlan({ id: 'p1', code: 'basic' }),
        mockPlan({ id: 'p2', code: 'pro' }),
      ];
      const prices = [mockPrice({ planId: 'p2', unitAmount: 999 })];

      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce(prices);

      const result = await service.listPublicPlans();

      expect(result).toHaveLength(1);
      expect(result[0]!.code).toBe('pro');
    });

    it('should return empty array when no active plans exist', async () => {
      planRepo.find.mockResolvedValueOnce([]);

      const result = await service.listPublicPlans();

      expect(result).toEqual([]);
    });

    it('should return empty array when no plans have active prices', async () => {
      const plans = [mockPlan({ id: 'p1', code: 'basic' })];
      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce([]);

      const result = await service.listPublicPlans();

      expect(result).toEqual([]);
    });

    it('should batch-load prices for all plans in a single query', async () => {
      const plans = [
        mockPlan({ id: 'p1', code: 'basic' }),
        mockPlan({ id: 'p2', code: 'pro' }),
      ];
      const prices = [
        mockPrice({ id: 'pr1', planId: 'p1' }),
        mockPrice({ id: 'pr2', planId: 'p2' }),
      ];

      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce(prices);

      await service.listPublicPlans();

      // Should only call find once for prices (batch), never per-plan
      expect(priceRepo.find).toHaveBeenCalledTimes(1);
    });

    it('should return plans ordered by displayOrder ASC, createdAt ASC', async () => {
      // Mock returns plans in DB order (displayOrder ASC)
      const plans = [
        mockPlan({ id: 'p1', code: 'free', displayOrder: 1 }),
        mockPlan({ id: 'p2', code: 'pro', displayOrder: 2 }),
      ];
      planRepo.find.mockResolvedValueOnce(plans);
      priceRepo.find.mockResolvedValueOnce([
        mockPrice({ planId: 'p1' }),
        mockPrice({ planId: 'p2' }),
      ]);

      const result = await service.listPublicPlans();

      expect(result[0]!.code).toBe('free');
      expect(result[1]!.code).toBe('pro');
    });

    it('should include only prices returned by query (active)', async () => {
      const plan = mockPlan({ id: 'p1', code: 'basic' });
      planRepo.find.mockResolvedValueOnce([plan]);
      // The query already filters active:true — the service trusts the DB result
      priceRepo.find.mockResolvedValueOnce([
        mockPrice({ planId: 'p1', active: true }),
      ]);

      const result = await service.listPublicPlans();

      expect(result).toHaveLength(1);
      expect(result[0]!.prices).toHaveLength(1);
    });
  });
});
