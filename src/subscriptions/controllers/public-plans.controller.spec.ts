import { Test, TestingModule } from '@nestjs/testing';
import { PublicPlansController } from './public-plans.controller';
import { PlanService } from '../services/plan.service';

describe('PublicPlansController', () => {
  let controller: PublicPlansController;
  let planService: jest.Mocked<PlanService>;

  beforeEach(async () => {
    planService = {
      listPublicPlans: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicPlansController],
      providers: [
        {
          provide: PlanService,
          useValue: planService,
        },
      ],
    }).compile();

    controller = module.get<PublicPlansController>(PublicPlansController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listPlans', () => {
    it('should return active plans', async () => {
      const mockPlans = [
        {
          id: 'plan-1',
          code: 'pro',
          name: 'Pro',
          prices: [],
        },
      ];
      planService.listPublicPlans.mockResolvedValue(mockPlans as any);

      const result = await controller.listPlans();

      expect(result).toEqual(mockPlans);
      expect(planService.listPublicPlans).toHaveBeenCalledTimes(1);
    });
  });
});
