import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Plan } from '../entities/plan.entity';
import { Price } from '../entities/price.entity';
import { PlanStatus, PriceType } from '../common/subscription.enums';
import {
  CreatePlanDto,
  UpdatePlanDto,
  CreatePriceDto,
  PlanResponseDto,
  PriceResponseDto,
} from '../dto/plan.dto';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(Price)
    private readonly priceRepository: Repository<Price>,
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
    this.logger.log(`Plan created: ${saved.code}`);
    return this.toPlanResponse(saved, []);
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    const plan = await this.getPlanEntity(id);
    if (plan.status === PlanStatus.ARCHIVED) {
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
    plan.status = PlanStatus.ARCHIVED;
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

  async listPlans(status?: PlanStatus): Promise<PlanResponseDto[]> {
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
    const priceMap = new Map<string, Price[]>();
    for (const price of prices) {
      const list = priceMap.get(price.planId) ?? [];
      list.push(price);
      priceMap.set(price.planId, list);
    }
    return plans.map((plan) =>
      this.toPlanResponse(plan, priceMap.get(plan.id) ?? []),
    );
  }

  async listPublicPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.planRepository.find({
      where: { status: PlanStatus.ACTIVE },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
    if (plans.length === 0) return [];
    const prices = await this.priceRepository.find({
      where: { planId: In(plans.map((p) => p.id)), active: true },
      order: { unitAmount: 'ASC' },
    });
    const priceMap = new Map<string, Price[]>();
    for (const price of prices) {
      const list = priceMap.get(price.planId) ?? [];
      list.push(price);
      priceMap.set(price.planId, list);
    }
    return plans
      .filter((plan) => (priceMap.get(plan.id) ?? []).length > 0)
      .map((plan) => this.toPlanResponse(plan, priceMap.get(plan.id) ?? []));
  }

  async addPrice(
    planId: string,
    dto: CreatePriceDto,
  ): Promise<PriceResponseDto> {
    await this.getPlanEntity(planId);
    const price = this.priceRepository.create({
      planId,
      stripePriceId: dto.stripePriceId,
      stripeProductId: dto.stripeProductId ?? null,
      currency: dto.currency.toLowerCase(),
      unitAmount: dto.unitAmount,
      type: dto.type,
      interval:
        dto.type === PriceType.RECURRING ? (dto.interval ?? null) : null,
      trialPeriodDays: dto.trialPeriodDays ?? null,
      active: dto.active ?? true,
    });
    const saved = await this.priceRepository.save(price);
    return this.toPriceResponse(saved);
  }

  async listPricesForPlan(planId: string): Promise<PriceResponseDto[]> {
    const prices = await this.priceRepository.find({
      where: { planId },
      order: { unitAmount: 'ASC' },
    });
    return prices.map((p) => this.toPriceResponse(p));
  }

  async deactivatePrice(id: string): Promise<PriceResponseDto> {
    const price = await this.priceRepository.findOne({ where: { id } });
    if (!price) throw new NotFoundException(`Price ${id} not found.`);
    price.active = false;
    const saved = await this.priceRepository.save(price);
    return this.toPriceResponse(saved);
  }

  private async getPlanEntity(id: string): Promise<Plan> {
    const plan = await this.planRepository.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan ${id} not found.`);
    return plan;
  }

  private toPlanResponse(plan: Plan, prices: Price[]): PlanResponseDto {
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
      prices: prices.map((p) => this.toPriceResponse(p)),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  private toPriceResponse(price: Price): PriceResponseDto {
    return {
      id: price.id,
      planId: price.planId,
      stripePriceId: price.stripePriceId,
      stripeProductId: price.stripeProductId,
      currency: price.currency,
      unitAmount: price.unitAmount,
      type: price.type,
      interval: price.interval,
      trialPeriodDays: price.trialPeriodDays,
      active: price.active,
      createdAt: price.createdAt,
      updatedAt: price.updatedAt,
    };
  }
}
