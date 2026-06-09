import { Test, TestingModule } from '@nestjs/testing';
import { PublicPlansController } from './public-plans.controller';
import { PlanDisplayService } from '../services/plan-display.service';

describe('PublicPlansController', () => {
  let controller: PublicPlansController;
  let planDisplay: jest.Mocked<PlanDisplayService>;

  beforeEach(async () => {
    planDisplay = {
      listPublicPlans: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicPlansController],
      providers: [{ provide: PlanDisplayService, useValue: planDisplay }],
    }).compile();

    controller = module.get<PublicPlansController>(PublicPlansController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /plans', () => {
    it('should return active plans with prices', async () => {
      const mockPlans = [
        { id: 'p1', code: 'free', name: 'Free', prices: [] },
        { id: 'p2', code: 'pro', name: 'Pro', prices: [{ id: 'pr1' }] },
      ];
      planDisplay.listPublicPlans.mockResolvedValueOnce(mockPlans as any);

      const result = await controller.listPlans();

      expect(planDisplay.listPublicPlans).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]!.code).toBe('free');
    });

    it('should return empty array when no plans available', async () => {
      planDisplay.listPublicPlans.mockResolvedValueOnce([]);

      const result = await controller.listPlans();

      expect(result).toEqual([]);
    });
  });
});
