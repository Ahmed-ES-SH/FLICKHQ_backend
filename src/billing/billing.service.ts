import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserSubscription, SubscriptionStatus } from './user-subscription.entity';
import { User } from '../user/schema/user.entity';
import { Price } from '../subscriptions/entities/price.entity';
import type { StripeInstance } from '../config/stripe.config';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';
import { mapStripeStatus } from './utils/status.mapper';
import { PaymentHistoryDto } from './dto/payment-history.dto';

/**
 * BillingService — Subscription-first checkout flow.
 *
 * Flow:
 * 1. ensureCustomer() → creates Stripe customer if needed
 * 2. createCheckoutSession() → creates a Subscription with `default_incomplete`,
 *    returns the latest_invoice.payment_intent client_secret for Stripe Elements
 * 3. User confirms payment via Elements → Stripe pays the subscription invoice
 * 4. Webhook `invoice.paid` → transitions subscription to ACTIVE
 *
 * The old flow (PaymentIntent → then Subscription) caused double-charges.
 * This flow uses the subscription's own invoice PaymentIntent for collection.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: StripeInstance,
    @InjectRepository(UserSubscription)
    private readonly subRepo: Repository<UserSubscription>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Price) private readonly priceRepo: Repository<Price>,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── 1. Ensure Stripe Customer ───────────────────────────

  async ensureCustomer(
    user: User,
  ): Promise<{ customerId: string; email: string }> {
    // Refetch user from DB to get the latest stripeCustomerId (JWT payload
    // may be stale). This also helps prevent duplicate customer creation
    // when ensureCustomer is called concurrently (most calls will see the
    // saved stripeCustomerId after the first creation).
    const freshUser = await this.userRepo.findOne({ where: { id: user.id } });
    if (!freshUser) throw new NotFoundException('User not found');

    if (freshUser.stripeCustomerId) {
      return {
        customerId: freshUser.stripeCustomerId,
        email: freshUser.email,
      };
    }

    // Check Stripe for an existing customer by email before creating a new
    // one — this handles the StrictMode double-mount / concurrent-call race
    // where both requests see stripeCustomerId === null.
    const existing = await this.stripe.customers.list({
      email: user.email,
      limit: 10,
    });
    const matched = existing.data.find(
      (c) => c.metadata?.userId === String(user.id),
    );
    if (matched) {
      await this.userRepo.update(user.id, {
        stripeCustomerId: matched.id,
      });
      this.logger.log(
        `Reusing existing Stripe customer ${matched.id} for user ${user.id}`,
      );
      return { customerId: matched.id, email: user.email };
    }

    // Create Stripe customer
    const customer = await this.stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: String(user.id) },
    });

    // Save to user record
    await this.userRepo.update(user.id, {
      stripeCustomerId: customer.id,
    });

    this.logger.log(
      `Created Stripe customer ${customer.id} for user ${user.id}`,
    );
    return { customerId: customer.id, email: user.email };
  }

  // ─── 2. Create Checkout Session (Subscription-first) ────
  //
  // Creates a Stripe Subscription with `payment_behavior: 'default_incomplete'`
  // and returns `latest_invoice.payment_intent.client_secret` for Stripe Elements.
  // The user confirms payment on the subscription's own invoice — no separate PI.

  async createCheckoutSession(
    userId: number,
    priceId: string,
    idempotencyKey?: string,
  ): Promise<{ clientSecret?: string; subscriptionId: string; status?: string }> {
    // Validate price
    const price = await this.priceRepo.findOne({
      where: { id: priceId, active: true },
      relations: ['plan'],
    });
    if (!price) throw new NotFoundException('Price not found or inactive');

    // Get user and ensure customer
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const { customerId } = await this.ensureCustomer(user);

    // Check for duplicate active subscription on same plan
    const planCode = price.plan?.code;
    if (planCode) {
      const existing = await this.subRepo.findOne({
        where: {
          userId,
          planCode,
          status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]),
        },
      });
      if (existing) {
        throw new ConflictException(
          'You already have an active subscription for this plan',
        );
      }
    }

    // Generate a unique idempotency key per request to prevent Stripe from
    // rejecting the call with "Keys for idempotent requests can only be used
    // with the same parameters". The client may reuse the same key across
    // different checkout attempts (different prices, different users), so we
    // derive a server-side key that is unique per attempt yet stable for retries.
    const key =
      idempotencyKey ??
      `checkout-${userId}-${priceId}-${randomUUID()}`;

    // Create Subscription with `default_incomplete` — the first invoice's
    // PaymentIntent is what Elements will confirm.
    //
    // NOTE: In Stripe API version 2026-05-27.dahlia (and later), invoice
    // finalization is deferred — Stripe waits for webhook delivery before
    // auto-finalizing. This means `expand: ['latest_invoice.payment_intent']`
    // no longer returns a PaymentIntent on subscription creation (the invoice
    // is still in `draft`). We manually finalize the invoice below to get the
    // PaymentIntent client_secret immediately.
    const stripeSub = await this.stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: price.stripePriceId }],
        trial_period_days: price.trialPeriodDays ?? undefined,
        metadata: {
          userId: String(userId),
          priceId: price.id,
          planCode: planCode ?? '',
        },
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice'],
      },
      { idempotencyKey: key },
    );

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const latestInvoice = stripeSub.latest_invoice as any;
    const invoiceId =
      typeof latestInvoice === 'string' ? latestInvoice : latestInvoice?.id;

    if (!invoiceId) {
      // No invoice means the subscription is free or trial-only.
      // Save a local record immediately since no payment confirmation is needed.
      this.logger.log(
        `Subscription ${stripeSub.id} (user ${userId}) — no invoice (free/trial)`,
      );
      await this.subRepo.save({
        userId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId: customerId,
        status: mapStripeStatus(stripeSub.status),
        planCode: planCode ?? '',
        stripePriceId: price.stripePriceId,
        cancelAtPeriodEnd: false,
      });
      return { subscriptionId: stripeSub.id, status: 'no_payment_needed' } as any;
    }

    // Manually finalize the invoice to create/expand the PaymentIntent.
    // Stripe API version 2026-05-27.dahlia defers auto-finalization until
    // the webhook is delivered. If the webhook was already delivered and
    // acknowledged, Stripe may have auto-finalized the invoice before we
    // get here — handle that gracefully by retrieving the invoice instead.
    let finalized: any;
    try {
      finalized = (await this.stripe.invoices.finalizeInvoice(invoiceId, {
        expand: ['payment_intent'],
      })) as any;
    } catch (err: any) {
      if (
        err?.type === 'StripeInvalidRequestError' &&
        err?.message?.includes?.('already finalized')
      ) {
        this.logger.warn(
          `Invoice ${invoiceId} already finalized (race with webhook), retrieving...`,
        );
        finalized = (await this.stripe.invoices.retrieve(invoiceId, {
          expand: ['payment_intent'],
        })) as any;
      } else {
        throw err;
      }
    }

    const pi = finalized.payment_intent;
    const clientSecret: string | undefined =
      pi && typeof pi !== 'string' ? pi.client_secret : undefined;

    if (!clientSecret) {
      // Payment was already completed (e.g., $0 trial invoice, or saved
      // payment method was used successfully). No confirmation needed from
      // the client — the subscription is already active.
      // Save a local record immediately so the success page can find it.
      this.logger.log(
        `Subscription ${stripeSub.id} (user ${userId}) — ` +
          `invoice ${invoiceId} finalized, no client_secret needed (status: ${finalized.status})`,
      );
      await this.subRepo.save({
        userId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId: customerId,
        status: mapStripeStatus(stripeSub.status),
        planCode: planCode ?? '',
        stripePriceId: price.stripePriceId,
        cancelAtPeriodEnd: false,
      });
      return { subscriptionId: stripeSub.id, status: 'no_payment_needed' } as any;
    }

    this.logger.log(
      `Created Subscription ${stripeSub.id} for user ${userId} — ` +
        `invoice ${invoiceId}, PI ${pi.id}`,
    );

    return {
      clientSecret,
      subscriptionId: stripeSub.id,
    };
  }

  // ─── 3. Change Plan (upgrade/downgrade) ──────────────────

  async changePlan(userId: number, newPriceId: string): Promise<UserSubscription> {
    // Find current active subscription
    const current = await this.subRepo.findOne({
      where: {
        userId,
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]),
      },
    });
    if (!current) throw new NotFoundException('No active subscription');

    // Validate new price
    const newPrice = await this.priceRepo.findOne({
      where: { id: newPriceId, active: true },
      relations: ['plan'],
    });
    if (!newPrice) throw new NotFoundException('Price not found');

    // Prevent same plan
    if (current.planCode === newPrice.plan?.code) {
      throw new ConflictException('You are already on this plan');
    }

    // Update on Stripe with idempotency key
    const stripeSub = await this.stripe.subscriptions.retrieve(
      current.stripeSubscriptionId,
    );
    const item = stripeSub.items.data[0];
    if (!item) {
      throw new BadRequestException('Subscription has no items');
    }

    const updated = await this.stripe.subscriptions.update(
      current.stripeSubscriptionId,
      {
        items: [{ id: item.id, price: newPrice.stripePriceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          userId: String(userId),
          planCode: newPrice.plan?.code ?? '',
        },
      },
      {
        idempotencyKey: `change-plan-${current.stripeSubscriptionId}-${newPriceId}`,
      },
    );

    // Update local — webhook will also update, but we update here for
    // immediate consistency in the API response
    current.planCode = newPrice.plan?.code ?? current.planCode;
    current.stripePriceId = newPrice.stripePriceId;
    current.status = mapStripeStatus(updated.status);
    await this.subRepo.save(current);

    this.logger.log(`User ${userId} changed plan to ${current.planCode}`);
    return current;
  }

  // ─── 4. Cancel Subscription ──────────────────────────────

  async cancelSubscription(userId: number): Promise<UserSubscription> {
    const subscription = await this.subRepo.findOne({
      where: {
        userId,
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]),
      },
    });
    if (!subscription) throw new NotFoundException('No active subscription');

    // Cancel on Stripe (at period end) with idempotency key
    await this.stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
      {
        idempotencyKey: `cancel-${subscription.stripeSubscriptionId}`,
      },
    );

    // Update local record immediately for responsive UI
    subscription.cancelAtPeriodEnd = true;
    await this.subRepo.save(subscription);

    this.logger.log(
      `User ${userId} scheduled cancellation for subscription ${subscription.id}`,
    );
    return subscription;
  }

  // ─── 5. Get Current Subscription ─────────────────────────

  async getCurrentSubscription(
    userId: number,
  ): Promise<{
    id: string;
    status: SubscriptionStatus;
    planName: string | null;
    planCode: string;
    priceCurrency: string | null;
    priceUnitAmount: number | null;
    priceInterval: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    createdAt: Date;
  } | null> {
    const sub = await this.subRepo.findOne({
      where: {
        userId,
        status: In([
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.PAST_DUE,
        ]),
      },
      order: { createdAt: 'DESC' },
    });
    if (!sub) return null;

    // Enrich with plan name and price details
    let planName: string | null = null;
    let priceCurrency: string | null = null;
    let priceUnitAmount: number | null = null;
    let priceInterval: string | null = null;

    const price = await this.priceRepo.findOne({
      where: { stripePriceId: sub.stripePriceId },
      relations: ['plan'],
    });
    if (price) {
      priceCurrency = price.currency;
      priceUnitAmount = price.unitAmount;
      priceInterval = price.interval;
      planName = price.plan?.name ?? null;
    }

    // Fetch period dates, trial end, canceled at from Stripe
    let currentPeriodStart: string | null = null;
    let currentPeriodEnd: string | null = null;
    let trialEnd: string | null = null;
    let canceledAt: string | null = null;

    try {
      const stripeSub = (await this.stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId,
      )) as any;
      currentPeriodStart = stripeSub.current_period_start
        ? new Date(stripeSub.current_period_start * 1000).toISOString()
        : null;
      currentPeriodEnd = stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000).toISOString()
        : null;
      trialEnd = stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000).toISOString()
        : null;
      canceledAt = stripeSub.canceled_at
        ? new Date(stripeSub.canceled_at * 1000).toISOString()
        : null;
    } catch (err) {
      this.logger.warn(
        `Failed to retrieve Stripe subscription ${sub.stripeSubscriptionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      id: sub.id,
      status: sub.status,
      planName,
      planCode: sub.planCode,
      priceCurrency,
      priceUnitAmount,
      priceInterval,
      currentPeriodStart,
      currentPeriodEnd,
      trialEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt,
      createdAt: sub.createdAt,
    };
  }

  // ─── 6. Get Subscription History ─────────────────────────

  async getSubscriptionHistory(userId: number): Promise<UserSubscription[]> {
    return this.subRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── 7. Get Payment History (from Stripe) ────────────────

  async getPaymentHistory(userId: number): Promise<PaymentHistoryDto[]> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.stripeCustomerId) return [];

    const invoices = await this.stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 50,
    });

    return invoices.data.map((inv) => ({
      id: inv.id,
      amount: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      description: inv.description,
      created: new Date(inv.created * 1000),
      invoicePdf: inv.invoice_pdf ?? null,
    }));
  }
}
