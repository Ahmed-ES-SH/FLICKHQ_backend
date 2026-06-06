/**
 * HTTP-layer tests for the public plans endpoint. Verifies that
 * the controller passes query parameters through to the service
 * and that response DTOs are returned as expected.
 */

import { Test, TestingModule } from '@nestjs/testing';

import { BillingPublicController } from './billing.public.controller';
import { BillingCatalogService } from '../services/billing-catalog.service';
import { BillingPublicPlanResponseDto } from '../dto/billing-plan.dto';
import {
  BillingPriceType,
  BillingRecurringInterval,
} from '../common/billing.enums';

describe('BillingPublicController', () => {
  let controller: BillingPublicController;
  let catalog: jest.Mocked<BillingCatalogService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingPublicController],
      providers: [
        {
          provide: BillingCatalogService,
          useValue: {
            listPublicPlans: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(BillingPublicController);
    catalog = module.get(BillingCatalogService);
  });

  it('passes through the query to the service and returns the result', async () => {
    const plans: BillingPublicPlanResponseDto[] = [
      {
        id: 'plan-1',
        code: 'pro_monthly',
        name: 'Pro',
        description: null,
        features: ['premium_reports'],
        prices: [
          {
            id: 'price-1',
            planId: 'plan-1',
            stripePriceId: 'price_1',
            stripeProductId: null,
            currency: 'usd',
            unitAmount: 1999,
            type: BillingPriceType.RECURRING,
            interval: BillingRecurringInterval.MONTH,
            trialPeriodDays: null,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ];
    catalog.listPublicPlans.mockResolvedValueOnce(plans);

    const result = await controller.listPublicPlans({ currency: 'USD' });
    expect(result).toBe(plans);
    expect(catalog['listPublicPlans']).toHaveBeenCalledWith({
      currency: 'USD',
    });
  });
});
