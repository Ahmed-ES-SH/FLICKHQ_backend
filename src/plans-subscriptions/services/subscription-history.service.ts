import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { QueryFailedError, Repository } from 'typeorm';
import { PlanSubscriptionHistory } from '../entities/plan-subscription-history.entity';
import { BILLING_EVENTS } from '../../billing/common/billing.constants';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { SubscriptionHistoryResponseDto } from '../dto/subscription-history-response.dto';

const PG_UNIQUE_VIOLATION = '23505';

export interface SubscriptionStatusChangeParams {
  userId: number;
  subscriptionId: string | null;
  previousStatus: BillingSubscriptionStatus | null;
  newStatus: BillingSubscriptionStatus;
  planId: string | null;
  priceId: string | null;
  stripeEventId: string | null;
  reason: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

@Injectable()
export class SubscriptionHistoryService {
  private readonly logger = new Logger(SubscriptionHistoryService.name);

  constructor(
    @InjectRepository(PlanSubscriptionHistory)
    private readonly historyRepository: Repository<PlanSubscriptionHistory>,
  ) {}

  /**
   * Record a subscription status change. If the stripeEventId already
   * exists (duplicate webhook delivery), the record is silently skipped.
   */
  async recordStatusChange(
    params: SubscriptionStatusChangeParams,
  ): Promise<void> {
    const entry = this.historyRepository.create({
      userId: params.userId,
      subscriptionId: params.subscriptionId,
      previousStatus: params.previousStatus,
      newStatus: params.newStatus,
      planId: params.planId,
      priceId: params.priceId,
      stripeEventId: params.stripeEventId,
      reason: params.reason,
      metadata: params.metadata ?? {},
      occurredAt: params.occurredAt ?? new Date(),
    });

    try {
      await this.historyRepository.save(entry);
      this.logger.log(
        `Subscription history recorded: user=${params.userId} sub=${params.subscriptionId} ${params.previousStatus ?? '(none)'} -> ${params.newStatus}`,
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        this.logger.log(
          `Duplicate stripeEventId ${params.stripeEventId} — skipping history record.`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Get the full timeline for a single subscription.
   */
  async getHistoryForSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionHistoryResponseDto[]> {
    const records = await this.historyRepository.find({
      where: { subscriptionId },
      order: { occurredAt: 'DESC' },
    });

    return records.map(this.toHistoryResponse);
  }

  /**
   * Get all subscription changes for a user, paginated, ordered by occurredAt DESC.
   */
  async getHistoryForUser(
    userId: number,
    pagination: PaginationQueryDto,
  ): Promise<{
    items: SubscriptionHistoryResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = pagination.page;
    const limit = pagination.limit;
    const skip = (page - 1) * limit;

    const [items, total] = await this.historyRepository.findAndCount({
      where: { userId },
      order: { occurredAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      items: items.map(this.toHistoryResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Look up the most recent known status for a subscription from the
   * history table. Returns null if no prior history exists (first event).
   */
  private async getPreviousStatus(
    subscriptionId: string | null,
  ): Promise<BillingSubscriptionStatus | null> {
    if (!subscriptionId) return null;

    const lastRecord = await this.historyRepository.findOne({
      where: { subscriptionId },
      order: { occurredAt: 'DESC' },
    });

    return lastRecord?.newStatus ?? null;
  }

  // ─────────────────────────────────────────────
  // Event listeners — fired by BillingWebhookService
  // ─────────────────────────────────────────────

  @OnEvent(BILLING_EVENTS.SUBSCRIPTION_CREATED)
  async handleSubscriptionCreated(payload: {
    userId: number;
    billingCustomerId: string;
    localSubscriptionId: string;
    stripeSubscriptionId: string;
    status: BillingSubscriptionStatus;
  }): Promise<void> {
    await this.recordStatusChange({
      userId: payload.userId,
      subscriptionId: payload.localSubscriptionId,
      previousStatus: null,
      newStatus: payload.status,
      planId: null,
      priceId: null,
      stripeEventId: null,
      reason: `event: ${BILLING_EVENTS.SUBSCRIPTION_CREATED}`,
      metadata: {
        stripeSubscriptionId: payload.stripeSubscriptionId,
      },
    });
  }

  @OnEvent(BILLING_EVENTS.SUBSCRIPTION_UPDATED)
  async handleSubscriptionUpdated(payload: {
    userId: number;
    billingCustomerId: string;
    localSubscriptionId: string;
    stripeSubscriptionId: string;
    status: BillingSubscriptionStatus;
  }): Promise<void> {
    const previousStatus = await this.getPreviousStatus(
      payload.localSubscriptionId,
    );
    await this.recordStatusChange({
      userId: payload.userId,
      subscriptionId: payload.localSubscriptionId,
      previousStatus,
      newStatus: payload.status,
      planId: null,
      priceId: null,
      stripeEventId: null,
      reason: `event: ${BILLING_EVENTS.SUBSCRIPTION_UPDATED}`,
      metadata: {
        stripeSubscriptionId: payload.stripeSubscriptionId,
      },
    });
  }

  @OnEvent(BILLING_EVENTS.SUBSCRIPTION_CANCELED)
  async handleSubscriptionCanceled(payload: {
    userId: number;
    billingCustomerId: string;
    localSubscriptionId: string;
    stripeSubscriptionId: string;
  }): Promise<void> {
    const previousStatus = await this.getPreviousStatus(
      payload.localSubscriptionId,
    );
    await this.recordStatusChange({
      userId: payload.userId,
      subscriptionId: payload.localSubscriptionId,
      previousStatus,
      newStatus: BillingSubscriptionStatus.CANCELED,
      planId: null,
      priceId: null,
      stripeEventId: null,
      reason: `event: ${BILLING_EVENTS.SUBSCRIPTION_CANCELED}`,
      metadata: {
        stripeSubscriptionId: payload.stripeSubscriptionId,
      },
    });
  }

  private toHistoryResponse(
    record: PlanSubscriptionHistory,
  ): SubscriptionHistoryResponseDto {
    return {
      id: record.id,
      subscriptionId: record.subscriptionId,
      previousStatus: record.previousStatus,
      newStatus: record.newStatus,
      planId: record.planId,
      priceId: record.priceId,
      reason: record.reason,
      occurredAt: record.occurredAt,
      createdAt: record.createdAt,
    };
  }
}
