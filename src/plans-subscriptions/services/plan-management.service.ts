import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingPlan } from '../../billing/entities/billing-plan.entity';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import { BillingPlanStatus } from '../../billing/common/billing.enums';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { PlanResponseDto } from '../dto/plan-response.dto';

@Injectable()
export class PlanManagementService {
  private readonly logger = new Logger(PlanManagementService.name);

  constructor(
    @InjectRepository(BillingPlan)
    private readonly planRepository: Repository<BillingPlan>,
    @InjectRepository(BillingPrice)
    private readonly priceRepository: Repository<BillingPrice>,
  ) {}

  async createPlan(dto: CreatePlanDto): Promise<PlanResponseDto> {
    const plan = this.planRepository.create({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      features: dto.features ?? [],
      displayOrder: dto.displayOrder ?? 0,
      icon: dto.icon ?? null,
      highlight: dto.highlight ?? false,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.planRepository.save(plan);
    this.logger.log(`Plan created: ${saved.code} (${saved.id})`);

    return this.toPlanResponse(saved, []);
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    const plan = await this.getPlanEntity(id);

    if (plan.status === BillingPlanStatus.ARCHIVED) {
      throw new ConflictException(`Cannot update archived plan ${id}.`);
    }

    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.displayOrder !== undefined) plan.displayOrder = dto.displayOrder;
    if (dto.icon !== undefined) plan.icon = dto.icon;
    if (dto.highlight !== undefined) plan.highlight = dto.highlight;
    if (dto.metadata !== undefined) plan.metadata = dto.metadata;

    const saved = await this.planRepository.save(plan);
    const prices = await this.priceRepository.find({
      where: { planId: saved.id },
      order: { unitAmount: 'ASC' },
    });

    return this.toPlanResponse(saved, prices);
  }

  async archivePlan(id: string): Promise<PlanResponseDto> {
    const plan = await this.getPlanEntity(id);
    plan.status = BillingPlanStatus.ARCHIVED;
    const saved = await this.planRepository.save(plan);
    const prices = await this.priceRepository.find({
      where: { planId: saved.id },
      order: { unitAmount: 'ASC' },
    });

    return this.toPlanResponse(saved, prices);
  }

  async getPlan(id: string): Promise<PlanResponseDto> {
    const plan = await this.getPlanEntity(id);
    const prices = await this.priceRepository.find({
      where: { planId: plan.id },
      order: { unitAmount: 'ASC' },
    });

    return this.toPlanResponse(plan, prices);
  }

  async listPlans(status?: BillingPlanStatus): Promise<PlanResponseDto[]> {
    const where = status ? { status } : {};
    const plans = await this.planRepository.find({
      where,
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });

    if (plans.length === 0) return [];

    const prices = await this.priceRepository.find({
      where: { planId: In(plans.map((p) => p.id)) },
      order: { unitAmount: 'ASC' },
    });

    const priceMap = new Map<string, BillingPrice[]>();
    for (const price of prices) {
      const list = priceMap.get(price.planId) ?? [];
      list.push(price);
      priceMap.set(price.planId, list);
    }

    return plans.map((plan) =>
      this.toPlanResponse(plan, priceMap.get(plan.id) ?? []),
    );
  }

  private async getPlanEntity(id: string): Promise<BillingPlan> {
    const plan = await this.planRepository.findOne({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`Plan ${id} not found.`);
    }
    return plan;
  }

  private toPlanResponse(
    plan: BillingPlan,
    prices: BillingPrice[],
  ): PlanResponseDto {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      features: plan.features,
      displayOrder: plan.displayOrder,
      icon: plan.icon,
      highlight: plan.highlight,
      prices: prices.map((p) => ({
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
    };
  }
}
