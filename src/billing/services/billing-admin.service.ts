/**
 * BillingAdminService
 *
 * Provides admin/support endpoints for operational visibility and
 * manual intervention:
 *
 * - Operational overview (subscription counts, failed payments,
 *   failed webhooks).
 * - Failed webhook listing and replay.
 * - Refund command that calls Stripe and records a lightweight
 *   `BillingTransaction(type=refund)` row.
 *
 * All methods assume the caller is authenticated as an admin (the
 * `RolesGuard` on `BillingAdminController` enforces that).
 *
 * Design notes:
 *
 * - Financial reporting is intentionally kept in Stripe Dashboard.
 *   This service provides only operational data.
 * - Refunds do not use a dedicated `BillingRefund` table; they are
 *   stored as transactions (type = 'refund') and aggregated via
 *   `amountRefunded` on the payment row.
 * - The refund path uses `BillingIdempotencyService` so admin
 *   retries of the same idempotency key do not create duplicate
 *   Stripe refunds.
 * - Webhook replay bypasses signature verification (the event was
 *   already verified when first received) and re-dispatches through
 *   the existing handler pipeline.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BillingCustomer } from '../entities/billing-customer.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import { BillingWebhookEvent } from '../entities/billing-webhook-event.entity';

import { BillingStripeService } from './billing-stripe.service';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingIdempotencyService } from './billing-idempotency.service';

import {
  BillingPaymentStatus,
  BillingTransactionStatus,
  BillingTransactionType,
  BillingWebhookEventStatus,
} from '../common/billing.enums';

import type {
  BillingAdminOverviewResponseDto,
  BillingAdminSubscriptionCountDto,
  BillingAdminRecentFailedPaymentDto,
  BillingAdminListFailedWebhooksResponseDto,
  BillingAdminRefundResponseDto,
} from '../dto/billing-admin.dto';

import type { WebhookReceiveResult } from './billing-webhook.service';
import { BILLING_EVENTS } from '../common/billing.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BillingAdminService {
  private readonly logger = new Logger(BillingAdminService.name);

  constructor(
    @InjectRepository(BillingCustomer)
    private readonly customerRepository: Repository<BillingCustomer>,
    @InjectRepository(BillingSubscription)
    private readonly subscriptionRepository: Repository<BillingSubscription>,
    @InjectRepository(BillingPayment)
    private readonly paymentRepository: Repository<BillingPayment>,
    @InjectRepository(BillingTransaction)
    private readonly transactionRepository: Repository<BillingTransaction>,
    @InjectRepository(BillingWebhookEvent)
    private readonly webhookEventRepository: Repository<BillingWebhookEvent>,
    private readonly stripeService: BillingStripeService,
    private readonly webhookService: BillingWebhookService,
    private readonly idempotency: BillingIdempotencyService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Overview
  // ─────────────────────────────────────────────────────────────────

  /**
   * Return an operational snapshot of the billing system. All counts
   * are based on local rows; authoritative financial data remains in
   * Stripe Dashboard.
   */
  async getOverview(): Promise<BillingAdminOverviewResponseDto> {
    const [
      totalCustomers,
      subscriptionsByStatus,
      recentFailedPayments,
      failedWebhooksCount,
    ] = await Promise.all([
      this.customerRepository.count(),
      this.countSubscriptionsByStatus(),
      this.findRecentFailedPayments(10),
      this.webhookEventRepository.count({
        where: { status: BillingWebhookEventStatus.FAILED },
      }),
    ]);

    return {
      totalCustomers,
      subscriptionsByStatus,
      recentFailedPayments,
      failedWebhooksCount,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Failed webhooks
  // ─────────────────────────────────────────────────────────────────

  /**
   * Return a paginated list of failed webhook events, most recent
   * first. Phase 7 uses a fixed limit (100) — pagination is added
   * if the module grows beyond that.
   */
  async listFailedWebhooks(
    limit = 100,
  ): Promise<BillingAdminListFailedWebhooksResponseDto> {
    const [data, total] = await this.webhookEventRepository.findAndCount({
      where: { status: BillingWebhookEventStatus.FAILED },
      order: { receivedAt: 'DESC' },
      take: Math.min(limit, 500),
    });

    return {
      data: data.map((row) => ({
        id: row.id,
        stripeEventId: row.stripeEventId,
        eventType: row.eventType,
        errorMessage: row.errorMessage,
        processingAttempts: row.processingAttempts,
        status: row.status,
        receivedAt: row.receivedAt,
        processedAt: row.processedAt,
      })),
      total,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Webhook replay
  // ─────────────────────────────────────────────────────────────────

  /**
   * Re-dispatch a previously-failed webhook event. Delegates to
   * `BillingWebhookService.replayEvent` which bypasses signature
   * verification and re-runs the handler pipeline.
   *
   * Returns null if the event id does not exist.
   */
  async replayWebhook(eventId: string): Promise<WebhookReceiveResult | null> {
    return this.webhookService.replayEvent(eventId);
  }

  // ─────────────────────────────────────────────────────────────────
  // Refund
  // ─────────────────────────────────────────────────────────────────

  /**
   * Issue a refund for a local `BillingPayment`. The payment must
   * exist and be in a refundable state (`succeeded` or
   * `partially_refunded`). The refund amount defaults to the full
   * remaining refundable balance when not specified.
   *
   * The method:
   *
   * 1. Validates the payment and calculates the refundable amount.
   * 2. Calls `stripe.refunds.create` via `safeCall`.
   * 3. Records a `BillingTransaction(type=refund)` row.
   * 4. Updates `BillingPayment.amountRefunded` and status.
   *
   * Requires an idempotency key to prevent duplicate Stripe refunds
   * on network retry.
   */
  async refundPayment(
    paymentId: string,
    idempotencyKey: string,
    amount?: number,
  ): Promise<BillingAdminRefundResponseDto> {
    const normalizedKey = this.idempotency.normalizeKey(idempotencyKey);
    const reservation = await this.idempotency.reserve({
      key: normalizedKey,
      scope: 'admin.refund',
      userId: null,
      request: { paymentId, amount },
    });
    if (!reservation.fresh && reservation.cachedResponse) {
      return reservation.cachedResponse as unknown as BillingAdminRefundResponseDto;
    }

    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
    });
    if (!payment) {
      await this.idempotency.recordFailure(normalizedKey);
      throw new NotFoundException(`Billing payment ${paymentId} not found.`);
    }

    if (
      payment.status !== BillingPaymentStatus.SUCCEEDED &&
      payment.status !== BillingPaymentStatus.PARTIALLY_REFUNDED
    ) {
      await this.idempotency.recordFailure(normalizedKey);
      throw new BadRequestException(
        `Payment ${paymentId} has status "${payment.status}" and cannot be refunded. ` +
          'Only succeeded or partially_refunded payments are refundable.',
      );
    }

    const refundable = payment.amount - payment.amountRefunded;
    if (refundable <= 0) {
      await this.idempotency.recordFailure(normalizedKey);
      throw new BadRequestException(
        `Payment ${paymentId} has already been fully refunded (amount=${payment.amount}, amountRefunded=${payment.amountRefunded}).`,
      );
    }

    const refundAmount = amount ?? refundable;
    if (refundAmount <= 0 || refundAmount > refundable) {
      await this.idempotency.recordFailure(normalizedKey);
      throw new BadRequestException(
        `Refund amount ${refundAmount} is invalid. Must be between 1 and ${refundable} (the remaining refundable amount).`,
      );
    }

    if (!payment.stripePaymentIntentId) {
      await this.idempotency.recordFailure(normalizedKey);
      throw new BadRequestException(
        `Payment ${paymentId} has no Stripe PaymentIntent id; cannot refund.`,
      );
    }

    try {
      const refund = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().refunds.create({
          payment_intent: payment.stripePaymentIntentId!,
          amount: refundAmount,
        }),
      );

      const tx = this.transactionRepository.create({
        userId: payment.userId,
        paymentId: payment.id,
        type: BillingTransactionType.REFUND,
        amount: refundAmount,
        currency: payment.currency,
        status: BillingTransactionStatus.SUCCEEDED,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        stripeRefundId: refund.id,
        occurredAt: new Date(),
        metadata: {
          source: 'admin.refund',
          adminInitiated: true,
        },
      });
      await this.transactionRepository.save(tx);

      payment.amountRefunded += refundAmount;
      payment.status =
        payment.amountRefunded >= payment.amount
          ? BillingPaymentStatus.REFUNDED
          : BillingPaymentStatus.PARTIALLY_REFUNDED;
      await this.paymentRepository.save(payment);

      this.eventEmitter.emit(BILLING_EVENTS.REFUND_SUCCEEDED, {
        userId: payment.userId,
        billingCustomerId: payment.billingCustomerId,
        localPaymentId: payment.id,
        refundId: refund.id,
        amount: refundAmount,
        source: 'admin',
      });

      this.logger.log(
        `Admin refund: payment=${paymentId}, amount=${refundAmount}, refundId=${refund.id}`,
      );

      const response: BillingAdminRefundResponseDto = {
        transactionId: tx.id,
        stripeRefundId: refund.id,
        amount: refundAmount,
        currency: payment.currency,
        status: tx.status,
      };

      await this.idempotency.recordSuccess(
        normalizedKey,
        response as unknown as Record<string, unknown>,
      );
      return response;
    } catch (err) {
      await this.idempotency.recordFailure(normalizedKey);
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  private async countSubscriptionsByStatus(): Promise<
    BillingAdminSubscriptionCountDto[]
  > {
    const raw = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .select('sub.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('sub.status')
      .orderBy('count', 'DESC')
      .getRawMany<{ status: string; count: string | number }>();

    return raw.map((r) => ({
      status: r.status,
      count:
        typeof r.count === 'string' ? Number.parseInt(r.count, 10) : r.count,
    }));
  }

  private async findRecentFailedPayments(
    limit: number,
  ): Promise<BillingAdminRecentFailedPaymentDto[]> {
    const rows = await this.paymentRepository.find({
      where: { status: BillingPaymentStatus.FAILED },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      description: p.description,
      createdAt: p.createdAt,
    }));
  }
}
