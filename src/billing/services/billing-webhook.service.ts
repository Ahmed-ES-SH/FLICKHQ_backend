/**
 * BillingWebhookService
 *
 * The single entry point for Stripe webhooks. The controller
 * (`StripeWebhookController`) hands us the raw request body and the
 * `Stripe-Signature` header. We:
 *
 * 1. Verify the signature via `BillingStripeService.constructWebhookEvent`.
 *    Invalid signatures are rejected at the service layer; the
 *    controller translates that to a 400.
 * 2. Persist the event row in `billing_webhook_events` keyed by
 *    `stripe_event_id`. The unique index gives us idempotency for
 *    free — a duplicate delivery is detected here and the original
 *    result is returned.
 * 3. Dispatch to the right handler. Handlers update
 *    `BillingPayment` / `BillingSubscription` / `BillingInvoice` /
 *    `BillingTransaction` and emit internal `billing.*` events.
 *    The source-of-truth handlers also call
 *    `BillingEntitlementsService.recomputeForUser` so that
 *    feature access tracks the latest billing state.
 * 4. Mark the row `processed`, `failed`, or `ignored`.
 *
 * Failure model:
 *
 * - **Invalid signature** → service throws
 *   `StripeSignatureVerificationFailedError` (400). No row written.
 * - **Duplicate event id** → service returns `{ kind: 'duplicate' }`
 *   and the controller replies 200. No handler runs.
 * - **Handler succeeds** → service returns `{ kind: 'processed' }`,
 *   the controller replies 200.
 * - **Handler reports "this event does not apply"** (e.g. we
 *   received `customer.subscription.updated` for a subscription we
 *   have never seen) → mark `ignored`, reply 200. Stripe will not
 *   retry.
 * - **Handler throws a transient error** (DB blip, Stripe lookup
 *   failure, etc.) → mark `failed`, rethrow. The controller replies
 *   5xx so Stripe will retry with backoff.
 *
 * Module boundary rules:
 *
 * - This is the only place in the codebase that calls the Stripe
 *   webhook API. The only Stripe SDK call is delegated to
 *   `BillingStripeService.constructWebhookEvent`.
 * - Handlers do not call Stripe; they only translate the event
 *   payload into local state.
 * - Refunds become `BillingTransaction(type=refund)` rows — the
 *   dedicated `BillingRefund` table is intentionally out of scope
 *   for MVP.
 * - Invoices are persisted as summaries on `BillingInvoice`. There
 *   is no `BillingInvoiceLine` entity.
 * - Subscription shells created in Phase 4 used a placeholder
 *   `pending_sub:<localPaymentId>` to satisfy the unique index
 *   before the real `sub_…` was known. `customer.subscription.created`
 *   is where we replace the placeholder with the real id.
 * - Phase 6 wires `BillingEntitlementsService.recomputeForUser`
 *   into the source-of-truth handlers below. The recompute is
 *   best-effort: a thrown error is logged but the local billing
 *   row has already been written. The next webhook for the same
 *   user will heal the entitlement state.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Stripe from 'stripe';

import { BillingWebhookEvent } from '../entities/billing-webhook-event.entity';
import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingInvoice } from '../entities/billing-invoice.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';

import { BillingStripeService } from './billing-stripe.service';
import { BillingCustomerService } from './billing-customer.service';
import { BillingCheckoutService } from './billing-checkout.service';
import { BillingEntitlementsService } from './billing-entitlements.service';

import {
  BillingInvoiceStatus,
  BillingPaymentStatus,
  BillingSubscriptionStatus,
  BillingTransactionStatus,
  BillingTransactionType,
  BillingWebhookEventStatus,
} from '../common/billing.enums';
import {
  BILLING_EVENTS,
  STRIPE_WEBHOOK_EVENT_TYPES,
  type StripeWebhookEventType,
} from '../common/billing.constants';
import { BillingWebhookHandlerError } from '../common/billing.errors';
import {
  customerIdOf,
  epochSecondsToDate,
  extractLocalBillingIds,
  invoiceIdOf,
  invoiceSnapshotToStorable,
  subscriptionIdOf,
  toBillingInvoiceStatus,
  toBillingPaymentStatus,
  toBillingSubscriptionStatus,
  toBillingTransactionStatus,
  type LocalBillingIds,
  type StripeChargeSnapshot,
  type StripeCheckoutSessionSnapshot,
  type StripeCustomerSnapshot,
  type StripeInvoiceSnapshot,
  type StripeMetadataRecord,
  type StripePaymentIntentSnapshot,
  type StripeRefundSnapshot,
  type StripeSubscriptionSnapshot,
} from '../common/stripe-snapshot.util';

/**
 * Narrow shape of the Stripe event we actually consume. We avoid
 * pulling in the SDK's deep `Stripe.Event` union so the service
 * stays decoupled from any one version of the types.
 */
export interface BillingStripeEvent {
  id: string;
  type: string;
  api_version?: string | null;
  livemode?: boolean;
  created?: number;
  data?: { object?: Record<string, unknown> | null };
  request?: { id?: string | null } | null;
}

export type WebhookReceiveResult =
  | {
      kind: 'processed';
      stripeEventId: string;
      eventType: string;
    }
  | {
      kind: 'duplicate';
      stripeEventId: string;
      eventType: string;
      originalStatus: BillingWebhookEventStatus;
    }
  | {
      kind: 'ignored';
      stripeEventId: string;
      eventType: string;
      reason: string;
    }
  | {
      kind: 'failed';
      stripeEventId: string;
      eventType: string;
      errorMessage: string;
    };

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    @InjectRepository(BillingWebhookEvent)
    private readonly eventRepository: Repository<BillingWebhookEvent>,
    @InjectRepository(BillingPayment)
    private readonly paymentRepository: Repository<BillingPayment>,
    @InjectRepository(BillingSubscription)
    private readonly subscriptionRepository: Repository<BillingSubscription>,
    @InjectRepository(BillingInvoice)
    private readonly invoiceRepository: Repository<BillingInvoice>,
    @InjectRepository(BillingTransaction)
    private readonly transactionRepository: Repository<BillingTransaction>,
    private readonly stripeService: BillingStripeService,
    private readonly customerService: BillingCustomerService,
    private readonly checkoutService: BillingCheckoutService,
    private readonly entitlementsService: BillingEntitlementsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Entry point used by `StripeWebhookController`. Performs signature
   * verification, idempotent event persistence, dispatch, and
   * status bookkeeping. Never throws on handler "not applicable"
   * cases — those are returned as `kind: 'ignored'`. Throws only on
   * invalid signatures (controller → 400) and unexpected transient
   * errors (controller → 5xx so Stripe retries).
   */
  async receiveEvent(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<WebhookReceiveResult> {
    const event = this.stripeService.constructWebhookEvent(
      rawBody,
      signature,
    ) as unknown as BillingStripeEvent;

    if (!event.id || !event.type) {
      throw new BillingWebhookHandlerError(
        'Webhook payload is missing required id or type fields.',
        event.id ?? 'unknown',
        event.type ?? 'unknown',
      );
    }

    const existing = await this.eventRepository.findOne({
      where: { stripeEventId: event.id },
    });
    if (existing) {
      this.logger.log(
        `Duplicate webhook event ${event.id} (${event.type}); original status=${existing.status}`,
      );
      return {
        kind: 'duplicate',
        stripeEventId: event.id,
        eventType: event.type,
        originalStatus: existing.status,
      };
    }

    const row = await this.persistEventRow(event, rawBody);
    if (!row) {
      // Another worker won the insert race. The pre-flight findOne
      // already missed the row (it was being inserted concurrently).
      return {
        kind: 'duplicate',
        stripeEventId: event.id,
        eventType: event.type,
        originalStatus: BillingWebhookEventStatus.RECEIVED,
      };
    }

    try {
      const outcome = await this.dispatch(event);
      if (outcome === 'ignored') {
        await this.markIgnored(row.id);
        return {
          kind: 'ignored',
          stripeEventId: event.id,
          eventType: event.type,
          reason: 'no matching local resource',
        };
      }
      await this.markProcessed(row.id);
      return {
        kind: 'processed',
        stripeEventId: event.id,
        eventType: event.type,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const redacted = this.stripeService.redactSecrets(message);
      await this.markFailed(row.id, redacted);
      this.logger.error(
        `Webhook handler failed for ${event.id} (${event.type}): ${redacted}`,
      );

      if (err instanceof BillingWebhookHandlerError) {
        return {
          kind: 'failed',
          stripeEventId: event.id,
          eventType: event.type,
          errorMessage: redacted,
        };
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Persistence helpers
  // ─────────────────────────────────────────────────────────────────

  private async persistEventRow(
    event: BillingStripeEvent,
    rawBody: Buffer | string,
  ): Promise<BillingWebhookEvent | null> {
    const payload = this.serializeEventForRow(event, rawBody);
    const row = this.eventRepository.create({
      stripeEventId: event.id,
      eventType: event.type,
      apiVersion: event.api_version ?? null,
      livemode: Boolean(event.livemode),
      status: BillingWebhookEventStatus.RECEIVED,
      processingAttempts: 0,
      payload,
      receivedAt: this.timestampToDate(event.created) ?? new Date(),
    });

    try {
      return await this.eventRepository.save(row);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        // Another worker beat us to the insert. Signal to the caller
        // that this is a duplicate; do not dispatch the event a
        // second time.
        return null;
      }
      throw err;
    }
  }

  private async markProcessed(id: string): Promise<void> {
    await this.eventRepository.update(
      { id },
      {
        status: BillingWebhookEventStatus.PROCESSED,
        processedAt: new Date(),
        errorMessage: null,
      },
    );
  }

  private async markFailed(id: string, message: string): Promise<void> {
    await this.eventRepository.increment({ id }, 'processingAttempts', 1);
    await this.eventRepository.update(
      { id },
      {
        status: BillingWebhookEventStatus.FAILED,
        errorMessage: message.slice(0, 4000),
      },
    );
  }

  private async markIgnored(id: string): Promise<void> {
    await this.eventRepository.update(
      { id },
      {
        status: BillingWebhookEventStatus.IGNORED,
        processedAt: new Date(),
        errorMessage: null,
      },
    );
  }

  private serializeEventForRow(
    event: BillingStripeEvent,
    rawBody: Buffer | string,
  ): Record<string, unknown> {
    // Prefer the parsed event if available — it's what the handlers
    // will read. The raw body is intentionally not persisted to avoid
    // double-storing PII; debugging can be done with the parsed shape
    // plus the Stripe Dashboard event log.
    if (event && typeof event === 'object' && event.data) {
      const payload: Record<string, unknown> = {
        id: event.id,
        type: event.type,
        api_version: event.api_version ?? null,
        livemode: Boolean(event.livemode),
        created: event.created ?? null,
        request: event.request ?? null,
        data: event.data ?? null,
      };
      return payload;
    }
    return { raw: typeof rawBody === 'string' ? rawBody : '<buffer>' };
  }

  private timestampToDate(value: number | undefined): Date | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return new Date(value * 1000);
  }

  // ─────────────────────────────────────────────────────────────────
  // Dispatch
  // ─────────────────────────────────────────────────────────────────

  private async dispatch(
    event: BillingStripeEvent,
  ): Promise<'processed' | 'ignored'> {
    const type = event.type as StripeWebhookEventType;
    const dataObject = event.data?.object ?? null;

    switch (type) {
      case STRIPE_WEBHOOK_EVENT_TYPES.CHECKOUT_SESSION_COMPLETED:
        return this.handleCheckoutSessionCompleted(
          dataObject as unknown as StripeCheckoutSessionSnapshot,
          extractLocalBillingIds(
            (dataObject as { metadata?: StripeMetadataRecord } | null)
              ?.metadata,
          ),
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CHECKOUT_SESSION_EXPIRED:
        return this.handleCheckoutSessionExpired(
          dataObject as unknown as StripeCheckoutSessionSnapshot,
          extractLocalBillingIds(
            (dataObject as { metadata?: StripeMetadataRecord } | null)
              ?.metadata,
          ),
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_SUCCEEDED:
        return this.handlePaymentIntentSucceeded(
          dataObject as unknown as StripePaymentIntentSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_PAYMENT_FAILED:
        return this.handlePaymentIntentFailed(
          dataObject as unknown as StripePaymentIntentSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CHARGE_SUCCEEDED:
        return this.handleChargeSucceeded(
          dataObject as unknown as StripeChargeSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CHARGE_REFUNDED:
        return this.handleChargeRefunded(
          dataObject as unknown as StripeChargeSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_CREATED:
      case STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_UPDATED:
        return this.handleCustomerUpsert(
          dataObject as unknown as StripeCustomerSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_CREATED:
        return this.handleSubscriptionCreated(
          dataObject as unknown as StripeSubscriptionSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED:
        return this.handleSubscriptionUpdated(
          dataObject as unknown as StripeSubscriptionSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_DELETED:
        return this.handleSubscriptionDeleted(
          dataObject as unknown as StripeSubscriptionSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_CREATED:
      case STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_FINALIZED:
      case STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAID:
      case STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_VOIDED:
      case STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_MARKED_UNCOLLECTIBLE:
        return this.handleInvoiceLifecycle(
          dataObject as unknown as StripeInvoiceSnapshot,
        );

      case STRIPE_WEBHOOK_EVENT_TYPES.INVOICE_PAYMENT_FAILED:
        return this.handleInvoicePaymentFailed(
          dataObject as unknown as StripeInvoiceSnapshot,
        );

      default:
        this.logger.log(
          `Ignoring unhandled Stripe event type "${event.type}" (id=${event.id})`,
        );
        return 'ignored';
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Handlers — Checkout
  // ─────────────────────────────────────────────────────────────────

  /**
   * `checkout.session.completed` is the canonical "user paid" event
   * for both one-time and subscription flows. It can arrive before
   * the more specific `payment_intent.succeeded` or
   * `customer.subscription.created` events. We do whatever we can
   * here and let the more specific events fill in the rest.
   */
  private async handleCheckoutSessionCompleted(
    session: StripeCheckoutSessionSnapshot,
    ids: LocalBillingIds,
  ): Promise<'processed' | 'ignored'> {
    if (!ids.localPaymentId) {
      this.logger.warn(
        `checkout.session.completed missing localPaymentId in metadata; session=${session.id}`,
      );
      return 'ignored';
    }

    const payment = await this.paymentRepository.findOne({
      where: { id: ids.localPaymentId },
    });
    if (!payment) {
      this.logger.warn(
        `checkout.session.completed for unknown local payment ${ids.localPaymentId}; session=${session.id}`,
      );
      return 'ignored';
    }

    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : ((session.payment_intent as { id?: string } | null)?.id ?? null);

    let changed = false;
    if (piId && payment.stripePaymentIntentId !== piId) {
      payment.stripePaymentIntentId = piId;
      changed = true;
    }
    if (session.id && payment.stripeCheckoutSessionId !== session.id) {
      payment.stripeCheckoutSessionId = session.id;
      changed = true;
    }
    if (
      payment.status === BillingPaymentStatus.CHECKOUT_CREATED ||
      payment.status === BillingPaymentStatus.PENDING
    ) {
      payment.status = toBillingPaymentStatus(
        session.payment_status ?? 'succeeded',
      );
      changed = true;
    }
    if (changed) await this.paymentRepository.save(payment);

    // Subscription shell: replace the pending_sub:<id> placeholder
    // with the real Stripe subscription id if Stripe included it.
    if (session.mode === 'subscription' && ids.localSubscriptionId) {
      const subscription = await this.subscriptionRepository.findOne({
        where: { id: ids.localSubscriptionId },
      });
      if (subscription) {
        const realSubId = subscriptionIdOf(session.subscription);
        if (realSubId) {
          let subChanged = false;
          if (subscription.stripeSubscriptionId !== realSubId) {
            subscription.stripeSubscriptionId = realSubId;
            subChanged = true;
          }
          if (
            session.id &&
            subscription.stripeCheckoutSessionId !== session.id
          ) {
            subscription.stripeCheckoutSessionId = session.id;
            subChanged = true;
          }
          if (subChanged) {
            await this.subscriptionRepository.save(subscription);
          }
        }
      }
    }

    this.eventEmitter.emit(BILLING_EVENTS.PAYMENT_SUCCEEDED, {
      userId: payment.userId,
      billingCustomerId: payment.billingCustomerId,
      localPaymentId: payment.id,
      sessionId: session.id,
      mode: session.mode,
    });

    return 'processed';
  }

  /**
   * `checkout.session.expired` is fired when the user abandons the
   * Checkout flow and the 24h session timer runs out. We mark the
   * local payment + subscription shell as canceled/expired so they
   * don't show up as in-flight on the user's account.
   */
  private async handleCheckoutSessionExpired(
    session: StripeCheckoutSessionSnapshot,
    ids: LocalBillingIds,
  ): Promise<'processed' | 'ignored'> {
    if (!ids.localPaymentId) return 'ignored';

    const payment = await this.paymentRepository.findOne({
      where: { id: ids.localPaymentId },
    });
    if (!payment) return 'ignored';

    if (payment.status === BillingPaymentStatus.SUCCEEDED) {
      // The user paid but Stripe fired an expired event? Treat as
      // informational — do not regress a successful payment.
      return 'processed';
    }

    payment.status = BillingPaymentStatus.CANCELED;
    if (!payment.stripeCheckoutSessionId) {
      payment.stripeCheckoutSessionId = session.id;
    }
    await this.paymentRepository.save(payment);

    if (ids.localSubscriptionId) {
      const subscription = await this.subscriptionRepository.findOne({
        where: { id: ids.localSubscriptionId },
      });
      if (
        subscription &&
        subscription.status === BillingSubscriptionStatus.INCOMPLETE
      ) {
        subscription.status = BillingSubscriptionStatus.INCOMPLETE_EXPIRED;
        await this.subscriptionRepository.save(subscription);
      }
    }

    return 'processed';
  }

  // ─────────────────────────────────────────────────────────────────
  // Handlers — PaymentIntent
  // ─────────────────────────────────────────────────────────────────

  private async handlePaymentIntentSucceeded(
    intent: StripePaymentIntentSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const payment = await this.findPaymentByIntent(intent);
    if (!payment) {
      this.logger.warn(
        `payment_intent.succeeded for unknown payment intent ${intent.id}`,
      );
      return 'ignored';
    }

    let changed = false;
    if (payment.stripePaymentIntentId !== intent.id) {
      payment.stripePaymentIntentId = intent.id;
      changed = true;
    }
    if (
      payment.status !== BillingPaymentStatus.SUCCEEDED &&
      payment.status !== BillingPaymentStatus.REFUNDED &&
      payment.status !== BillingPaymentStatus.PARTIALLY_REFUNDED
    ) {
      payment.status = toBillingPaymentStatus(intent.status ?? 'succeeded');
      changed = true;
    }
    if (changed) await this.paymentRepository.save(payment);

    await this.recordTransactionFromIntent(intent, payment);

    this.eventEmitter.emit(BILLING_EVENTS.PAYMENT_SUCCEEDED, {
      userId: payment.userId,
      billingCustomerId: payment.billingCustomerId,
      localPaymentId: payment.id,
      paymentIntentId: intent.id,
    });

    await this.recomputeEntitlements(payment.userId);

    return 'processed';
  }

  private async handlePaymentIntentFailed(
    intent: StripePaymentIntentSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const payment = await this.findPaymentByIntent(intent);
    if (!payment) {
      return 'ignored';
    }

    if (payment.status === BillingPaymentStatus.SUCCEEDED) {
      return 'processed';
    }

    payment.status = BillingPaymentStatus.FAILED;
    if (!payment.stripePaymentIntentId) {
      payment.stripePaymentIntentId = intent.id;
    }
    await this.paymentRepository.save(payment);

    this.eventEmitter.emit(BILLING_EVENTS.PAYMENT_FAILED, {
      userId: payment.userId,
      billingCustomerId: payment.billingCustomerId,
      localPaymentId: payment.id,
      paymentIntentId: intent.id,
      lastError: intent.last_payment_error?.message ?? null,
    });

    return 'processed';
  }

  private async handleChargeSucceeded(
    charge: StripeChargeSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent ?? null);
    if (!paymentIntentId) return 'ignored';

    const payment = await this.paymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!payment) return 'ignored';

    if (
      payment.status === BillingPaymentStatus.SUCCEEDED ||
      payment.status === BillingPaymentStatus.REFUNDED ||
      payment.status === BillingPaymentStatus.PARTIALLY_REFUNDED
    ) {
      return 'processed';
    }
    payment.status = BillingPaymentStatus.SUCCEEDED;
    await this.paymentRepository.save(payment);
    return 'processed';
  }

  /**
   * `charge.refunded` is the only refund signal Stripe emits on the
   * `Charge` object. The `refunds` collection on the expanded charge
   * (when present) carries the per-refund ids. We:
   *
   * - Insert a `BillingTransaction(type=refund)` row per refund
   *   (de-duplicated by `stripeRefundId`).
   * - Update `BillingPayment.amountRefunded` to the latest sum.
   * - Flip `BillingPayment.status` to `refunded` or
   *   `partially_refunded`.
   * - Emit `billing.refund.succeeded`.
   */
  private async handleChargeRefunded(
    charge: StripeChargeSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent ?? null);
    if (!paymentIntentId) return 'ignored';

    const payment = await this.paymentRepository.findOne({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!payment) return 'ignored';

    const refunds = this.extractRefundsFromCharge(charge);
    if (refunds.length === 0) {
      // Charge flagged refunded but we have no per-refund data;
      // reconcile the aggregate from the Charge snapshot.
      payment.amountRefunded = charge.amount_refunded ?? payment.amountRefunded;
      payment.status =
        (charge.amount_refunded ?? 0) >= (charge.amount ?? payment.amount)
          ? BillingPaymentStatus.REFUNDED
          : BillingPaymentStatus.PARTIALLY_REFUNDED;
      await this.paymentRepository.save(payment);

      this.eventEmitter.emit(BILLING_EVENTS.REFUND_SUCCEEDED, {
        userId: payment.userId,
        billingCustomerId: payment.billingCustomerId,
        localPaymentId: payment.id,
        chargeId: charge.id,
        refundIds: [],
      });
      return 'processed';
    }

    let totalRefunded = 0;
    const newRefundIds: string[] = [];
    for (const refund of refunds) {
      if (!refund.id) continue;

      const existing = await this.transactionRepository.findOne({
        where: { stripeRefundId: refund.id },
      });
      if (existing) {
        totalRefunded += existing.amount;
        continue;
      }

      const amount = refund.amount ?? 0;
      const tx = this.transactionRepository.create({
        userId: payment.userId,
        paymentId: payment.id,
        type: BillingTransactionType.REFUND,
        amount,
        currency: (refund.currency ?? payment.currency).toLowerCase(),
        status: toBillingTransactionStatus(refund.status ?? 'succeeded'),
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: charge.id,
        stripeRefundId: refund.id,
        occurredAt: new Date(),
        metadata: {
          reason: refund.reason ?? null,
          source: 'charge.refunded',
        },
      });
      await this.transactionRepository.save(tx);
      totalRefunded += amount;
      newRefundIds.push(refund.id);
    }

    // Also account for any refunds that already existed locally.
    const sumExisting = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'sum')
      .where('tx.payment_id = :id', { id: payment.id })
      .andWhere('tx.type = :type', { type: BillingTransactionType.REFUND })
      .getRawOne<{ sum: string | number }>();
    if (sumExisting) {
      const parsed =
        typeof sumExisting.sum === 'string'
          ? Number.parseInt(sumExisting.sum, 10)
          : sumExisting.sum;
      if (Number.isFinite(parsed)) {
        totalRefunded = parsed;
      }
    }

    payment.amountRefunded = totalRefunded;
    payment.status =
      totalRefunded >= payment.amount
        ? BillingPaymentStatus.REFUNDED
        : BillingPaymentStatus.PARTIALLY_REFUNDED;
    await this.paymentRepository.save(payment);

    this.eventEmitter.emit(BILLING_EVENTS.REFUND_SUCCEEDED, {
      userId: payment.userId,
      billingCustomerId: payment.billingCustomerId,
      localPaymentId: payment.id,
      chargeId: charge.id,
      refundIds: newRefundIds,
      amountRefunded: totalRefunded,
    });

    return 'processed';
  }

  // ─────────────────────────────────────────────────────────────────
  // Handlers — Customer
  // ─────────────────────────────────────────────────────────────────

  private async handleCustomerUpsert(
    customer: StripeCustomerSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const updated = await this.customerService.applyCustomerUpdate(customer);
    if (!updated) {
      // We don't have a local row yet — ignore. The local row will
      // be created the first time the user touches the billing API
      // (e.g. opens the portal), at which point the customer's
      // current state will be fetched.
      return 'ignored';
    }
    return 'processed';
  }

  // ─────────────────────────────────────────────────────────────────
  // Handlers — Subscription
  // ─────────────────────────────────────────────────────────────────

  private async handleSubscriptionCreated(
    subscription: StripeSubscriptionSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const local = await this.upsertSubscriptionFromStripe(subscription);
    if (!local) return 'ignored';

    this.eventEmitter.emit(BILLING_EVENTS.SUBSCRIPTION_CREATED, {
      userId: local.userId,
      billingCustomerId: local.billingCustomerId,
      localSubscriptionId: local.id,
      stripeSubscriptionId: local.stripeSubscriptionId,
      status: local.status,
    });
    await this.recomputeEntitlements(local.userId);
    return 'processed';
  }

  private async handleSubscriptionUpdated(
    subscription: StripeSubscriptionSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const local = await this.upsertSubscriptionFromStripe(subscription);
    if (!local) return 'ignored';

    this.eventEmitter.emit(BILLING_EVENTS.SUBSCRIPTION_UPDATED, {
      userId: local.userId,
      billingCustomerId: local.billingCustomerId,
      localSubscriptionId: local.id,
      stripeSubscriptionId: local.stripeSubscriptionId,
      status: local.status,
    });
    await this.recomputeEntitlements(local.userId);
    return 'processed';
  }

  private async handleSubscriptionDeleted(
    subscription: StripeSubscriptionSnapshot,
  ): Promise<'processed' | 'ignored'> {
    const stripeSubId = subscription.id;
    const local = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSubId },
    });
    if (!local) return 'ignored';

    local.status = BillingSubscriptionStatus.CANCELED;
    local.cancelAtPeriodEnd = true;
    local.canceledAt =
      epochSecondsToDate(subscription.canceled_at) ?? new Date();
    await this.subscriptionRepository.save(local);

    this.eventEmitter.emit(BILLING_EVENTS.SUBSCRIPTION_CANCELED, {
      userId: local.userId,
      billingCustomerId: local.billingCustomerId,
      localSubscriptionId: local.id,
      stripeSubscriptionId: local.stripeSubscriptionId,
    });
    // Deactivation of subscription-derived entitlements is the
    // primary effect of this recompute: a canceled subscription
    // should no longer grant any of its plan's features.
    await this.recomputeEntitlements(local.userId);
    return 'processed';
  }

  /**
   * Upsert a `BillingSubscription` from a Stripe subscription
   * snapshot. Handles two cases:
   *
   * - **Real id** (`sub_…`): the row already exists (or was just
   *   created by `checkout.session.completed`).
   * - **Placeholder** (`pending_sub:<localPaymentId>`): the row was
   *   created by `BillingCheckoutService` in Phase 4 and is matched
   *   via the `localPaymentId` in `subscription.metadata`. We
   *   replace the placeholder with the real id and update the rest
   *   of the columns.
   */
  private async upsertSubscriptionFromStripe(
    subscription: StripeSubscriptionSnapshot,
  ): Promise<BillingSubscription | null> {
    const stripeSubId = subscription.id;
    if (!stripeSubId) return null;

    let local = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSubId },
    });

    if (!local && subscription.metadata) {
      const ids = extractLocalBillingIds(subscription.metadata);
      if (ids.localSubscriptionId) {
        local = await this.subscriptionRepository.findOne({
          where: { id: ids.localSubscriptionId },
        });
        if (
          local &&
          this.checkoutService.isPlaceholderSubscriptionId(
            local.stripeSubscriptionId,
          )
        ) {
          local.stripeSubscriptionId = stripeSubId;
        }
      } else if (ids.localPaymentId) {
        // Subscription.metadata doesn't always carry
        // localSubscriptionId, but checkout writes
        // localPaymentId. Match by that.
        const placeholder = this.checkoutService.buildSubscriptionPlaceholderId(
          ids.localPaymentId,
        );
        local = await this.subscriptionRepository.findOne({
          where: { stripeSubscriptionId: placeholder },
        });
        if (local) {
          local.stripeSubscriptionId = stripeSubId;
        }
      }
    }

    if (!local) {
      this.logger.warn(
        `Subscription event for unknown subscription ${stripeSubId} (no local row or placeholder)`,
      );
      return null;
    }

    local.status = toBillingSubscriptionStatus(subscription.status);
    local.currentPeriodStart = epochSecondsToDate(
      subscription.current_period_start,
    );
    local.currentPeriodEnd = epochSecondsToDate(
      subscription.current_period_end,
    );
    local.trialEnd = epochSecondsToDate(subscription.trial_end);
    local.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    if (subscription.canceled_at) {
      local.canceledAt = epochSecondsToDate(subscription.canceled_at);
    }
    const latestInvoiceId = invoiceIdOf(subscription.latest_invoice);
    if (latestInvoiceId) {
      local.latestInvoiceId = latestInvoiceId;
    }

    return this.subscriptionRepository.save(local);
  }

  // ─────────────────────────────────────────────────────────────────
  // Handlers — Invoice
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generic upsert for the "lifecycle" invoice events
   * (created/finalized/paid/voided/marked_uncollectible). The same
   * shape applies for all of them — we just mirror the Stripe
   * summary into `BillingInvoice`.
   */
  private async handleInvoiceLifecycle(
    invoice: StripeInvoiceSnapshot,
  ): Promise<'processed' | 'ignored'> {
    if (!invoice.id) return 'ignored';

    const local = await this.upsertInvoiceFromStripe(invoice);
    if (!local) return 'ignored';

    if (invoice.status === 'paid') {
      this.eventEmitter.emit(BILLING_EVENTS.INVOICE_PAID, {
        userId: local.userId,
        billingCustomerId: null,
        localInvoiceId: local.id,
        stripeInvoiceId: local.stripeInvoiceId,
        amountPaid: local.amountPaid,
      });
    }
    return 'processed';
  }

  private async handleInvoicePaymentFailed(
    invoice: StripeInvoiceSnapshot,
  ): Promise<'processed' | 'ignored'> {
    if (!invoice.id) return 'ignored';

    const local = await this.upsertInvoiceFromStripe(invoice);
    if (!local) return 'ignored';

    // If the failed invoice is for a payment we know about, mark
    // the payment failed too.
    const paymentIntentId =
      typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : (invoice.payment_intent ?? null);
    if (paymentIntentId) {
      const payment = await this.paymentRepository.findOne({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (payment && payment.status !== BillingPaymentStatus.SUCCEEDED) {
        payment.status = BillingPaymentStatus.FAILED;
        await this.paymentRepository.save(payment);
      }
    }

    this.eventEmitter.emit(BILLING_EVENTS.INVOICE_PAYMENT_FAILED, {
      userId: local.userId,
      billingCustomerId: null,
      localInvoiceId: local.id,
      stripeInvoiceId: local.stripeInvoiceId,
    });
    await this.recomputeEntitlements(local.userId);
    return 'processed';
  }

  /**
   * Upsert a `BillingInvoice` from a Stripe invoice summary. The
   * `stripe_snapshot` jsonb is populated with a storable copy of
   * the source payload for support / debugging.
   */
  private async upsertInvoiceFromStripe(
    invoice: StripeInvoiceSnapshot,
  ): Promise<BillingInvoice | null> {
    const stripeInvoiceId = invoice.id;
    let local = await this.invoiceRepository.findOne({
      where: { stripeInvoiceId },
    });

    if (!local) {
      // The user-id and subscription-id columns are required. We
      // resolve them from the customer and the existing local
      // subscription (if any).
      const customerId = customerIdOf(invoice.customer ?? null);
      let userId: number | null = null;
      if (customerId) {
        const customer = await this.subscriptionRepository.manager
          .getRepository('billing_customers')
          .findOne({ where: { stripeCustomerId: customerId } });
        if (customer && typeof customer.userId === 'number') {
          userId = customer.userId;
        }
      }
      if (userId == null) {
        this.logger.warn(
          `Invoice ${stripeInvoiceId} has no matching local billing customer; ignoring`,
        );
        return null;
      }

      let subscriptionId: string | null = null;
      if (invoice.subscription) {
        const sub = await this.subscriptionRepository.findOne({
          where: { stripeSubscriptionId: invoice.subscription },
        });
        subscriptionId = sub?.id ?? null;
      }

      local = this.invoiceRepository.create({
        userId,
        subscriptionId,
        stripeInvoiceId,
        stripePaymentIntentId:
          typeof invoice.payment_intent === 'string'
            ? invoice.payment_intent
            : (invoice.payment_intent ?? null),
        status: BillingInvoiceStatus.DRAFT,
        currency: (invoice.currency ?? 'usd').toLowerCase(),
      });
    }

    local.status = toBillingInvoiceStatus(invoice.status);
    local.currency = (invoice.currency ?? local.currency).toLowerCase();
    local.subtotal = invoice.subtotal ?? local.subtotal;
    local.total = invoice.total ?? local.total;
    local.amountPaid = invoice.amount_paid ?? local.amountPaid;
    local.amountDue = invoice.amount_due ?? local.amountDue;
    local.hostedInvoiceUrl =
      invoice.hosted_invoice_url ?? local.hostedInvoiceUrl;
    local.invoicePdf = invoice.invoice_pdf ?? local.invoicePdf;
    local.number = invoice.number ?? local.number;
    local.periodStart = epochSecondsToDate(invoice.period_start);
    local.periodEnd = epochSecondsToDate(invoice.period_end);
    if (invoice.paid_at) {
      local.paidAt = epochSecondsToDate(invoice.paid_at);
    } else if (local.status === BillingInvoiceStatus.PAID && !local.paidAt) {
      local.paidAt = new Date();
    }
    if (typeof invoice.payment_intent === 'string') {
      local.stripePaymentIntentId = invoice.payment_intent;
    } else if (
      invoice.payment_intent &&
      typeof invoice.payment_intent === 'object'
    ) {
      const id = (invoice.payment_intent as { id?: string }).id;
      if (id) local.stripePaymentIntentId = id;
    }
    local.stripeSnapshot = invoiceSnapshotToStorable(invoice);

    return this.invoiceRepository.save(local);
  }

  // ─────────────────────────────────────────────────────────────────
  // Admin replay (Phase 7)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Re-dispatch a previously-failed webhook event from the stored
   * payload. Bypasses signature verification (the event was already
   * verified when first received). On success the event row is
   * flipped back to `processed`; on failure it stays `failed` and
   * the error message is updated.
   *
   * Returns null if the event id does not exist or its payload
   * cannot be reconstructed.
   */
  async replayEvent(eventId: string): Promise<WebhookReceiveResult | null> {
    const row = await this.eventRepository.findOne({
      where: { id: eventId },
    });
    if (!row) return null;

    const event = this.reconstructEventFromPayload(row.payload);
    if (!event) {
      await this.markFailed(
        row.id,
        'Cannot replay: stored payload is missing required fields',
      );
      return {
        kind: 'failed',
        stripeEventId: row.stripeEventId,
        eventType: row.eventType,
        errorMessage: 'Stored payload is missing required fields',
      };
    }

    try {
      const outcome = await this.dispatch(event);
      if (outcome === 'ignored') {
        await this.markIgnored(row.id);
        return {
          kind: 'ignored',
          stripeEventId: event.id,
          eventType: event.type,
          reason: 'no matching local resource',
        };
      }
      await this.markProcessed(row.id);
      return {
        kind: 'processed',
        stripeEventId: event.id,
        eventType: event.type,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const redacted = this.stripeService.redactSecrets(message);
      await this.markFailed(row.id, redacted);
      return {
        kind: 'failed',
        stripeEventId: event.id,
        eventType: event.type,
        errorMessage: redacted,
      };
    }
  }

  /**
   * Rebuild a `BillingStripeEvent` from the JSONB payload stored
   * by `serializeEventForRow`. Returns null if the payload does not
   * have the required `id`, `type`, and `data` fields.
   */
  private reconstructEventFromPayload(
    payload: Record<string, unknown>,
  ): BillingStripeEvent | null {
    if (!payload) return null;
    const id = payload.id as string | undefined;
    const type = payload.type as string | undefined;
    const data = payload.data as
      | { object?: Record<string, unknown> | null }
      | undefined;
    if (!id || !type || !data) return null;
    return {
      id,
      type,
      api_version: (payload.api_version as string | undefined) ?? null,
      livemode: Boolean(payload.livemode),
      created: payload.created as number | undefined,
      data,
      request: payload.request as { id?: string | null } | null | undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private async findPaymentByIntent(
    intent: StripePaymentIntentSnapshot,
  ): Promise<BillingPayment | null> {
    if (!intent.id) return null;
    return this.paymentRepository.findOne({
      where: { stripePaymentIntentId: intent.id },
    });
  }

  private async recordTransactionFromIntent(
    intent: StripePaymentIntentSnapshot,
    payment: BillingPayment,
  ): Promise<void> {
    if (!intent.id) return;

    // De-dupe on stripe_payment_intent_id + type=charge. We look it
    // up the same way the refund handler does, by stripe id, so a
    // retry of the same event never creates two rows.
    const existing = await this.transactionRepository.findOne({
      where: {
        stripePaymentIntentId: intent.id,
        type: BillingTransactionType.CHARGE,
      },
    });
    if (existing) return;

    const amount =
      intent.amount_received && intent.amount_received > 0
        ? intent.amount_received
        : (intent.amount ?? payment.amount);

    const tx = this.transactionRepository.create({
      userId: payment.userId,
      paymentId: payment.id,
      type: BillingTransactionType.CHARGE,
      amount,
      currency: (intent.currency ?? payment.currency).toLowerCase(),
      status: BillingTransactionStatus.SUCCEEDED,
      stripePaymentIntentId: intent.id,
      stripeChargeId: intent.latest_charge ?? null,
      occurredAt: new Date(),
      metadata: { source: 'payment_intent.succeeded' },
    });
    await this.transactionRepository.save(tx);
  }

  /**
   * Extract refund snapshots from a Charge payload. Stripe only
   * includes a `refunds` collection when the Charge is expanded on
   * the webhook; otherwise the count lives in `amount_refunded` and
   * the per-refund ids are not available. The caller is expected to
   * handle the empty case.
   */
  private extractRefundsFromCharge(
    charge: StripeChargeSnapshot,
  ): StripeRefundSnapshot[] {
    const refunds = (charge as { refunds?: { data?: StripeRefundSnapshot[] } })
      .refunds;
    if (!refunds || !Array.isArray(refunds.data)) return [];
    return refunds.data.filter((r) => typeof r?.id === 'string');
  }

  /**
   * Recompute the active entitlement set for a user. Called from
   * the source-of-truth handlers (subscription lifecycle, payment
   * success, invoice payment-failed). Failures are logged but do
   * not propagate — the local billing row has already been written
   * by the caller, and the next webhook for the same user will
   * heal the entitlement state.
   */
  private async recomputeEntitlements(userId: number): Promise<void> {
    // Let the error bubble up so the webhook handler fails with a
    // 5xx status and Stripe retries delivery. The local billing row
    // has already been written by the calling handler, so a retry
    // will pick up from there and attempt the recompute again.
    await this.entitlementsService.recomputeForUser(userId);
  }
}

/**
 * Re-export the Stripe namespace as a type-only escape hatch for
 * any future consumer that wants the SDK's full event union. We
 * don't use it inside this service — we deliberately depend on
 * the structural snapshot types in `stripe-snapshot.util.ts`.
 */
export type { Stripe };
