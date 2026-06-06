/**
 * BillingCatalogService
 *
 * CRUD for `BillingPlan` and `BillingPrice` rows. Used by the
 * admin controller (write paths) and the public controller (read
 * paths). Phase 4 will add a price-lookup helper used by the
 * checkout services to resolve client-supplied price codes to
 * local rows.
 *
 * Conventions:
 *
 * - A `BillingPlan` is metadata about a Stripe product; the
 *   service never calls Stripe. Prices are added by reference to
 *   a Stripe Price id that the operator created in the Stripe
 *   dashboard.
 * - All write paths check for `user-friendly` uniqueness
 *   violations on the `code` and `stripe_price_id` unique
 *   indexes and convert them into `ConflictException`s.
 * - The public read path strips prices that are inactive and
 *   skips plans with zero active prices.
 */

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';

import { BillingPlan } from '../entities/billing-plan.entity';
import { BillingPrice } from '../entities/billing-price.entity';
import { BillingPlanStatus, BillingPriceType } from '../common/billing.enums';
import {
  assertValidMinorAmount,
  normalizeCurrency,
} from '../common/money.util';
import {
  AddBillingPriceDto,
  CreateBillingPlanDto,
  ListBillingPublicPlansQueryDto,
  UpdateBillingPlanDto,
} from '../dto/billing-plan.dto';
import {
  BillingPlanResponseDto,
  BillingPriceResponseDto,
  BillingPublicPlanResponseDto,
} from '../dto/billing-plan.dto';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BillingCatalogService {
  private readonly logger = new Logger(BillingCatalogService.name);

  constructor(
    @InjectRepository(BillingPlan)
    private readonly planRepository: Repository<BillingPlan>,
    @InjectRepository(BillingPrice)
    private readonly priceRepository: Repository<BillingPrice>,
  ) {}

  // ─────────────────────────────────────────────
  // Plans — admin write paths
  // ─────────────────────────────────────────────

  /**
   * Create a new plan row. Plans are simple — no Stripe interaction.
   */
  async createPlan(dto: CreateBillingPlanDto): Promise<BillingPlan> {
    const plan = this.planRepository.create({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? BillingPlanStatus.DRAFT,
      features: dto.features ?? [],
    });

    try {
      const saved = await this.planRepository.save(plan);
      this.logger.log(`Billing plan created: ${saved.code} (${saved.id})`);
      return saved;
    } catch (err) {
      throw this.translatePlanConflict(err, dto.code);
    }
  }

  /**
   * Apply a partial update to a plan. `code` is intentionally not
   * updatable here.
   */
  async updatePlan(
    id: string,
    dto: UpdateBillingPlanDto,
  ): Promise<BillingPlan> {
    const plan = await this.getPlanEntity(id);
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.status !== undefined) plan.status = dto.status;
    if (dto.features !== undefined) plan.features = dto.features;
    try {
      return await this.planRepository.save(plan);
    } catch (err) {
      throw this.translatePlanConflict(err, plan.code);
    }
  }

  /**
   * Set a plan to `archived`. The price rows stay around (a Stripe
   * Price, once referenced in production, is effectively immutable)
   * but the plan itself is no longer sellable.
   */
  async archivePlan(id: string): Promise<BillingPlan> {
    return this.updatePlan(id, { status: BillingPlanStatus.ARCHIVED });
  }

  /**
   * Add a Stripe-backed price to a plan. The price id is supplied
   * by the caller (we do not call Stripe from this method).
   */
  async addPrice(
    planId: string,
    dto: AddBillingPriceDto,
  ): Promise<BillingPrice> {
    const plan = await this.getPlanEntity(planId);
    this.assertPriceInputShape(dto);

    const price = this.priceRepository.create({
      planId: plan.id,
      stripePriceId: dto.stripePriceId,
      stripeProductId: dto.stripeProductId ?? null,
      currency: normalizeCurrency(dto.currency),
      unitAmount: assertValidMinorAmount(dto.unitAmount, 'unit_amount'),
      type: dto.type,
      interval:
        dto.type === BillingPriceType.RECURRING ? (dto.interval ?? null) : null,
      trialPeriodDays: dto.trialPeriodDays ?? null,
      active: dto.active ?? true,
    });

    try {
      const saved = await this.priceRepository.save(price);
      this.logger.log(
        `Billing price added to plan ${plan.code}: ${saved.stripePriceId}`,
      );
      return saved;
    } catch (err) {
      throw this.translatePriceConflict(err, dto.stripePriceId);
    }
  }

  // ─────────────────────────────────────────────
  // Plans — read paths (admin and public)
  // ─────────────────────────────────────────────

  /**
   * Look up a plan by id, including its prices. Used by both the
   * admin and the (future) checkout services to validate that a
   * referenced price belongs to an active plan.
   */
  async getPlanWithPrices(
    id: string,
  ): Promise<{ plan: BillingPlan; prices: BillingPrice[] }> {
    const plan = await this.getPlanEntity(id);
    const prices = await this.priceRepository.find({
      where: { planId: plan.id },
      order: { unitAmount: 'ASC' },
    });
    return { plan, prices };
  }

  /**
   * Look up a price by its Stripe Price id. Returns null if not
   * found. Used by Phase 4 checkout services.
   */
  async findPriceByStripeId(
    stripePriceId: string,
  ): Promise<BillingPrice | null> {
    return this.priceRepository.findOne({ where: { stripePriceId } });
  }

  /**
   * Look up a price by its local UUID. Used by Phase 4 checkout
   * services to resolve a client-supplied priceId without
   * exposing the Stripe price id on the wire.
   */
  async findPriceById(id: string): Promise<BillingPrice | null> {
    return this.priceRepository.findOne({ where: { id } });
  }

  /**
   * Admin list-all with an optional status filter. Returns full
   * plan + price payloads. Phase 3 intentionally does not paginate
   * — the catalog is small.
   */
  async listAllPlans(
    status?: BillingPlanStatus,
  ): Promise<BillingPlanResponseDto[]> {
    const where = status ? { status } : {};
    const plans = await this.planRepository.find({
      where,
      order: { createdAt: 'ASC' },
    });
    if (plans.length === 0) return [];
    const prices = await this.priceRepository.find({
      where: { planId: In(plans.map((p) => p.id)) },
      order: { unitAmount: 'ASC' },
    });
    return this.groupPlansWithPrices(plans, prices);
  }

  /**
   * Public listing of active plans with their active prices. Used
   * by the marketing site / pricing page. Inactive plans and
   * inactive prices are filtered out.
   */
  async listPublicPlans(
    query: ListBillingPublicPlansQueryDto,
  ): Promise<BillingPublicPlanResponseDto[]> {
    const plans = await this.planRepository.find({
      where: { status: BillingPlanStatus.ACTIVE },
      order: { createdAt: 'ASC' },
    });
    if (plans.length === 0) return [];

    // Filter on `active` at the DB level for efficiency, then
    // re-apply the same filter in memory as a safety net (in case
    // a future refactor changes the query shape and accidentally
    // lets inactive rows through).
    const allPrices = await this.priceRepository.find({
      where: {
        planId: In(plans.map((p) => p.id)),
        active: true,
      },
      order: { unitAmount: 'ASC' },
    });

    const requestedCurrency = query.currency
      ? normalizeCurrency(query.currency)
      : null;

    const filtered = allPrices.filter((p) => {
      if (!p.active) return false;
      if (requestedCurrency && p.currency !== requestedCurrency) {
        return false;
      }
      return true;
    });

    const grouped = this.groupPlansWithPrices(plans, filtered).filter(
      (p) => p.prices.length > 0,
    );

    return grouped.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      features: p.features,
      prices: p.prices,
    }));
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  private async getPlanEntity(id: string): Promise<BillingPlan> {
    const plan = await this.planRepository.findOne({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`Billing plan ${id} not found.`);
    }
    return plan;
  }

  private assertPriceInputShape(dto: AddBillingPriceDto): void {
    if (dto.type === BillingPriceType.RECURRING && !dto.interval) {
      throw new ConflictException(
        'Recurring prices must specify an interval (day, week, month, year).',
      );
    }
    if (dto.type === BillingPriceType.ONE_TIME && dto.interval) {
      throw new ConflictException(
        'One-time prices must not specify a recurring interval.',
      );
    }
    if (
      dto.trialPeriodDays !== undefined &&
      dto.trialPeriodDays !== null &&
      dto.type !== BillingPriceType.RECURRING
    ) {
      throw new ConflictException(
        'Trial period days are only valid for recurring prices.',
      );
    }
  }

  private groupPlansWithPrices(
    plans: BillingPlan[],
    prices: BillingPrice[],
  ): BillingPlanResponseDto[] {
    const byPlan = new Map<string, BillingPrice[]>();
    for (const price of prices) {
      const list = byPlan.get(price.planId) ?? [];
      list.push(price);
      byPlan.set(price.planId, list);
    }
    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      features: plan.features,
      prices: (byPlan.get(plan.id) ?? []).map((p) => this.toPriceDto(p)),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    }));
  }

  private toPriceDto(price: BillingPrice): BillingPriceResponseDto {
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

  private translatePlanConflict(err: unknown, code: string): Error {
    if (
      err instanceof QueryFailedError &&
      (err as QueryFailedError & { code: string }).code === PG_UNIQUE_VIOLATION
    ) {
      const detail = (err as QueryFailedError & { detail?: string }).detail;
      if (detail?.includes('code')) {
        return new ConflictException(
          `Billing plan with code "${code}" already exists.`,
        );
      }
      return new ConflictException(
        `Billing plan conflicts with an existing record.`,
      );
    }
    return err as Error;
  }

  private translatePriceConflict(err: unknown, stripePriceId: string): Error {
    if (
      err instanceof QueryFailedError &&
      (err as QueryFailedError & { code: string }).code === PG_UNIQUE_VIOLATION
    ) {
      return new ConflictException(
        `Billing price with stripe id "${stripePriceId}" already exists.`,
      );
    }
    return err as Error;
  }
}
