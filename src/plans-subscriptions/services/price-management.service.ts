import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingPrice } from '../../billing/entities/billing-price.entity';
import { BillingPriceType } from '../../billing/common/billing.enums';
import { CreatePriceDto } from '../dto/create-price.dto';
import { PriceResponseDto } from '../dto/price-response.dto';
import { PlanManagementService } from './plan-management.service';

@Injectable()
export class PriceManagementService {
  private readonly logger = new Logger(PriceManagementService.name);

  constructor(
    @InjectRepository(BillingPrice)
    private readonly priceRepository: Repository<BillingPrice>,
    private readonly planManagement: PlanManagementService,
  ) {}

  async addPrice(
    planId: string,
    dto: CreatePriceDto,
  ): Promise<PriceResponseDto> {
    // Verify the plan exists
    await this.planManagement.getPlan(planId);

    const price = this.priceRepository.create({
      planId,
      stripePriceId: dto.stripePriceId,
      currency: dto.currency.toLowerCase(),
      unitAmount: dto.unitAmount,
      type: dto.type,
      interval:
        dto.type === BillingPriceType.RECURRING ? (dto.interval ?? null) : null,
      trialPeriodDays: dto.trialPeriodDays ?? null,
      active: dto.active ?? true,
    });

    const saved = await this.priceRepository.save(price);
    this.logger.log(`Price added to plan ${planId}: ${saved.stripePriceId}`);

    return this.toPriceResponse(saved);
  }

  async getPrice(id: string): Promise<PriceResponseDto> {
    const price = await this.priceRepository.findOne({
      where: { id },
      relations: ['plan'],
    });
    if (!price) {
      throw new NotFoundException(`Price ${id} not found.`);
    }
    return this.toPriceResponse(price);
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
    if (!price) {
      throw new NotFoundException(`Price ${id} not found.`);
    }
    price.active = false;
    const saved = await this.priceRepository.save(price);
    return this.toPriceResponse(saved);
  }

  private toPriceResponse(price: BillingPrice): PriceResponseDto {
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
