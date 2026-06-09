import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingPlan } from '../../billing/entities/billing-plan.entity';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import { BillingPlanStatus } from '../../billing/common/billing.enums';
import { PlanResponseDto } from '../dto/plan-response.dto';

@Injectable()
export class PlanDisplayService {
  constructor(
    @InjectRepository(BillingPlan)
    private readonly planRepository: Repository<BillingPlan>,
    @InjectRepository(BillingPrice)
    private readonly priceRepository: Repository<BillingPrice>,
  ) {}

  /**
   * List active plans with their active prices, ordered by displayOrder.
   * Used for the public pricing page.
   */
  async listPublicPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.planRepository.find({
      where: { status: BillingPlanStatus.ACTIVE },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });

    if (plans.length === 0) return [];

    const allPrices = await this.priceRepository.find({
      where: { planId: In(plans.map((p) => p.id)), active: true },
      order: { unitAmount: 'ASC' },
    });

    const priceMap = new Map<string, BillingPrice[]>();
    for (const price of allPrices) {
      const list = priceMap.get(price.planId) ?? [];
      list.push(price);
      priceMap.set(price.planId, list);
    }

    return plans
      .filter((plan) => (priceMap.get(plan.id) ?? []).length > 0)
      .map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        status: plan.status,
        features: plan.features,
        displayOrder: plan.displayOrder,
        icon: plan.icon,
        highlight: plan.highlight,
        prices: (priceMap.get(plan.id) ?? []).map((p) => ({
          id: p.id,
          planId: p.planId,
          stripePriceId: p.stripePriceId,
          stripeProductId: p.stripeProductId,
          currency: p.currency,
          unitAmount: p.unitAmount,
          type: p.type,
          interval: p.interval,
          trialPeriodDays: p.trialPeriodDays,
          active: p.active,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      }));
  }
}
