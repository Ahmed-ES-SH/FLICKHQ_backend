/**
 * BillingCheckoutService
 *
 * Creates Stripe Checkout Sessions for one-time payments and
 * subscriptions. The service is the only place in the codebase
 * that calls `stripe.checkout.sessions.create` for user-facing
 * flows.
 *
 * Responsibilities:
 *
 * - Server-side price resolution. The client supplies only a
 *   local `BillingPrice` UUID; the Stripe price id, currency,
 *   amount, and customer id are looked up locally. The plan
 *   (line 27) is explicit: "Never trust client-provided amounts,
 *   currency, price IDs, or customer IDs."
 * - Persistence of local shells. A `BillingPayment` row is
 *   always created; for subscriptions, a `BillingSubscription`
 *   row is also pre-created in `incomplete` state so the
 *   webhook handler (Phase 5) can attach the real Stripe
 *   subscription id.
 * - Idempotency. Both methods require an `Idempotency-Key`
 *   header; we delegate to `BillingIdempotencyService`.
 * - `payment_method_types` is **never** passed — dynamic payment
 *   methods are the default behavior in API 2026-05-27.dahlia.
 *
 * Non-goals:
 *
 * - Webhook handling. Phase 5 wires `BillingWebhookService` to
 *   update local state from `checkout.session.completed`,
 *   `customer.subscription.created`, `payment_intent.*`, etc.
 * - Entitlements. Phase 6 maps local state to feature keys.
 */

import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { Checkout as StripeCheckout } from 'stripe';

import { BillingPayment } from '../entities/billing-payment.entity';
import { BillingSubscription } from '../entities/billing-subscription.entity';
import { BillingPrice } from '../entities/billing-price.entity';
import { BillingPlan } from '../entities/billing-plan.entity';
import { BillingCatalogService } from './billing-catalog.service';
import { BillingCustomerService } from './billing-customer.service';
import { BillingIdempotencyService } from './billing-idempotency.service';
import { BillingStripeService } from './billing-stripe.service';
import {
  BillingPaymentStatus,
  BillingPlanStatus,
  BillingPriceType,
  BillingSubscriptionStatus,
} from '../common/billing.enums';
import { BILLING_EVENTS } from '../common/billing.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { formatMinorAmount } from '../common/money.util';
import {
  BillingError,
  BillingPriceNotActiveError,
} from '../common/billing.errors';

const ACTIVE_SUBSCRIPTION_STATES: BillingSubscriptionStatus[] = [
  BillingSubscriptionStatus.INCOMPLETE,
  BillingSubscriptionStatus.TRIALING,
  BillingSubscriptionStatus.ACTIVE,
  BillingSubscriptionStatus.PAST_DUE,
  BillingSubscriptionStatus.PAUSED,
  BillingSubscriptionStatus.UNPAID,
];

/**
 * Sentinel value used to satisfy the `stripe_subscription_id`
 * unique index while the real Stripe subscription is being
 * created in the user's browser. The webhook handler in
 * Phase 5 will look up the row by `stripe_checkout_session_id`
 * (or by `metadata.localSubscriptionId`) and replace the
 * placeholder.
 */
const SUBSCRIPTION_PENDING_PREFIX = 'pending_sub:';

export interface BillingCheckoutOneTimeInput {
  userId: number;
  priceId: string;
  quantity: number;
  allowPromotionCodes: boolean;
  idempotencyKey: string;
}

export interface BillingCheckoutSubscriptionInput {
  userId: number;
  priceId: string;
  quantity: number;
  clientReferenceId?: string | null;
  trialDays?: number | null;
  allowPromotionCodes: boolean;
  idempotencyKey: string;
  uiMode?: 'hosted_page' | 'embedded_page';
}

export interface BillingCheckoutSessionResult {
  sessionId: string;
  url: string;
  clientSecret?: string;
}

export interface BillingSubscriptionPaymentIntentInput {
  userId: number;
  priceId: string;
  quantity: number;
  clientReferenceId?: string | null;
  idempotencyKey: string;
}

export interface BillingSubscriptionPaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
}

export interface BillingCreateSubscriptionFromPaymentInput {
  userId: number;
  paymentIntentId: string;
  idempotencyKey: string;
}

export interface BillingCreateSubscriptionFromPaymentResult {
  subscriptionId: string;
  status: string;
}

@Injectable()
export class BillingCheckoutService {
  private readonly logger = new Logger(BillingCheckoutService.name);

  constructor(
    @InjectRepository(BillingPayment)
    private readonly paymentRepository: Repository<BillingPayment>,
    @InjectRepository(BillingSubscription)
    private readonly subscriptionRepository: Repository<BillingSubscription>,
    @InjectRepository(BillingPlan)
    private readonly planRepository: Repository<BillingPlan>,
    private readonly catalog: BillingCatalogService,
    private readonly customerService: BillingCustomerService,
    private readonly stripeService: BillingStripeService,
    private readonly idempotency: BillingIdempotencyService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─────────────────────────────────────────────
  // One-time Checkout
  // ─────────────────────────────────────────────

  /**
   * Create a one-time Stripe Checkout Session for a local
   * `BillingPrice`. The price must be active and of type
   * `one_time`.
   */
  async createOneTimeCheckout(
    input: BillingCheckoutOneTimeInput,
  ): Promise<BillingCheckoutSessionResult> {
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const idempotencyRequest = {
      priceId: input.priceId,
      quantity: input.quantity,
      allowPromotionCodes: input.allowPromotionCodes,
    };
    const reservation = await this.idempotency.reserve({
      key: idempotencyKey,
      scope: 'checkout.one_time',
      userId: input.userId,
      request: idempotencyRequest,
    });
    if (!reservation.fresh && reservation.cachedResponse) {
      return reservation.cachedResponse as unknown as BillingCheckoutSessionResult;
    }

    const price = await this.loadAndValidatePrice(input.priceId);
    this.assertPriceType(price, BillingPriceType.ONE_TIME, input.priceId);

    const customer = await this.customerService.getOrCreateForUser(
      input.userId,
    );

    const successUrl = this.requireConfig('STRIPE_SUCCESS_URL');
    const cancelUrl = this.requireConfig('STRIPE_CANCEL_URL');

    let payment: BillingPayment | null = null;
    try {
      payment = this.paymentRepository.create({
        userId: input.userId,
        billingCustomerId: customer.id,
        priceId: price.id,
        amount: price.unitAmount * input.quantity,
        currency: price.currency,
        status: BillingPaymentStatus.CHECKOUT_CREATED,
        description: this.buildOneTimeDescription(price),
        metadata: {
          source: 'checkout',
          allowPromotionCodes: input.allowPromotionCodes,
          quantity: input.quantity,
        },
      });
      payment = await this.paymentRepository.save(payment);

      const sessionParams: StripeCheckout.SessionCreateParams = {
        mode: 'payment',
        customer: customer.stripeCustomerId,
        line_items: [
          {
            price: price.stripePriceId,
            quantity: input.quantity,
          },
        ],
        success_url: this.appendSessionId(successUrl),
        cancel_url: cancelUrl,
        client_reference_id: payment.id,
        metadata: {
          localPaymentId: payment.id,
          localPriceId: price.id,
          billingCustomerId: customer.id,
          userId: String(input.userId),
        },
        // NOTE: payment_method_types intentionally omitted —
        // dynamic payment methods are the default behavior in
        // API 2026-05-27.dahlia.
        ...(input.allowPromotionCodes ? { allow_promotion_codes: true } : {}),
      };

      const session = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().checkout.sessions.create(sessionParams),
      );

      payment.stripeCheckoutSessionId = session.id;
      payment = await this.paymentRepository.save(payment);

      this.eventEmitter.emit(BILLING_EVENTS.CHECKOUT_CREATED, {
        kind: 'one_time',
        userId: input.userId,
        billingCustomerId: customer.id,
        localPaymentId: payment.id,
        sessionId: session.id,
      });

      const result: BillingCheckoutSessionResult = {
        sessionId: session.id,
        url: session.url ?? '',
      };

      await this.idempotency.recordSuccess(
        idempotencyKey,
        result as unknown as Record<string, unknown>,
      );
      return result;
    } catch (err) {
      await this.idempotency.recordFailure(idempotencyKey);
      throw err;
    }
  }

  // ─────────────────────────────────────────────
  // Subscription Checkout
  // ─────────────────────────────────────────────

  /**
   * Create a subscription Stripe Checkout Session for a local
   * recurring `BillingPrice`. The price must be active and of
   * type `recurring`. The plan must not be archived. The user
   * must not already have an active subscription (v1 ships
   * one-active-subscription-per-user; multiple concurrent
   * subscriptions are post-MVP).
   */
  async createSubscriptionCheckout(
    input: BillingCheckoutSubscriptionInput,
  ): Promise<BillingCheckoutSessionResult> {
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const idempotencyRequest = {
      priceId: input.priceId,
      quantity: input.quantity,
      clientReferenceId: input.clientReferenceId ?? null,
      trialDays: input.trialDays ?? null,
      allowPromotionCodes: input.allowPromotionCodes,
    };
    const reservation = await this.idempotency.reserve({
      key: idempotencyKey,
      scope: 'checkout.subscription',
      userId: input.userId,
      request: idempotencyRequest,
    });
    if (!reservation.fresh && reservation.cachedResponse) {
      return reservation.cachedResponse as unknown as BillingCheckoutSessionResult;
    }

    const price = await this.loadAndValidatePrice(input.priceId);
    this.assertPriceType(price, BillingPriceType.RECURRING, input.priceId);
    await this.assertPricePlanSellable(price.planId);

    await this.assertNoActiveSubscription(input.userId);

    const customer = await this.customerService.getOrCreateForUser(
      input.userId,
    );

    const successUrl = this.requireConfig('STRIPE_SUCCESS_URL');
    const cancelUrl = this.requireConfig('STRIPE_CANCEL_URL');

    let payment: BillingPayment | null = null;
    let subscription: BillingSubscription | null = null;
    try {
      payment = this.paymentRepository.create({
        userId: input.userId,
        billingCustomerId: customer.id,
        priceId: price.id,
        amount: price.unitAmount * input.quantity,
        currency: price.currency,
        status: BillingPaymentStatus.CHECKOUT_CREATED,
        description: this.buildSubscriptionDescription(price),
        metadata: {
          source: 'checkout',
          kind: 'subscription',
          allowPromotionCodes: input.allowPromotionCodes,
          quantity: input.quantity,
          clientReferenceId: input.clientReferenceId ?? null,
          trialDays: input.trialDays ?? null,
        },
      });
      payment = await this.paymentRepository.save(payment);

      const placeholderSubscriptionId = `${SUBSCRIPTION_PENDING_PREFIX}${payment.id}`;

      subscription = this.subscriptionRepository.create({
        userId: input.userId,
        billingCustomerId: customer.id,
        planId: price.planId,
        priceId: price.id,
        stripeSubscriptionId: placeholderSubscriptionId,
        stripeCheckoutSessionId: null,
        status: BillingSubscriptionStatus.INCOMPLETE,
        metadata: {
          source: 'checkout',
          localPaymentId: payment.id,
          clientReferenceId: input.clientReferenceId ?? null,
          trialDays: input.trialDays ?? null,
        },
      });
      subscription = await this.subscriptionRepository.save(subscription);

      const isEmbedded = input.uiMode === 'embedded_page';

      const sessionParams: StripeCheckout.SessionCreateParams = {
        mode: 'subscription',
        customer: customer.stripeCustomerId,
        line_items: [
          {
            price: price.stripePriceId,
            quantity: input.quantity,
          },
        ],
        client_reference_id: input.clientReferenceId ?? subscription.id,
        metadata: {
          localPaymentId: payment.id,
          localSubscriptionId: subscription.id,
          localPriceId: price.id,
          billingCustomerId: customer.id,
          userId: String(input.userId),
        },
        subscription_data: {
          metadata: {
            localPaymentId: payment.id,
            localSubscriptionId: subscription.id,
            localPriceId: price.id,
            billingCustomerId: customer.id,
            userId: String(input.userId),
          },
          ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
        },
        ...(input.allowPromotionCodes ? { allow_promotion_codes: true } : {}),
        // NOTE: payment_method_types intentionally omitted —
        // dynamic payment methods are the default behavior in
        // API 2026-05-27.dahlia.
      };

      if (isEmbedded) {
        sessionParams.ui_mode = 'embedded_page';
        sessionParams.return_url = this.appendSessionId(successUrl);
      } else {
        sessionParams.success_url = this.appendSessionId(successUrl);
        sessionParams.cancel_url = cancelUrl;
      }

      const session = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().checkout.sessions.create(sessionParams),
      );

      payment.stripeCheckoutSessionId = session.id;
      subscription.stripeCheckoutSessionId = session.id;
      await this.paymentRepository.save(payment);
      await this.subscriptionRepository.save(subscription);

      this.eventEmitter.emit(BILLING_EVENTS.CHECKOUT_CREATED, {
        kind: 'subscription',
        userId: input.userId,
        billingCustomerId: customer.id,
        localPaymentId: payment.id,
        localSubscriptionId: subscription.id,
        sessionId: session.id,
      });

      const result: BillingCheckoutSessionResult = {
        sessionId: session.id,
        url: session.url ?? '',
        ...(isEmbedded && session.client_secret
          ? { clientSecret: session.client_secret }
          : {}),
      };

      await this.idempotency.recordSuccess(
        idempotencyKey,
        result as unknown as Record<string, unknown>,
      );
      return result;
    } catch (err) {
      await this.idempotency.recordFailure(idempotencyKey);
      // If we created a subscription shell but the Stripe call
      // failed, mark the shell as expired so it does not show up
      // as an in-flight subscription on the user's account.
      if (subscription) {
        try {
          subscription.status = BillingSubscriptionStatus.INCOMPLETE_EXPIRED;
          await this.subscriptionRepository.save(subscription);
        } catch (cleanupErr) {
          this.logger.warn(
            `Failed to mark subscription shell ${subscription.id} as expired: ${
              (cleanupErr as Error).message
            }`,
          );
        }
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────
  // Subscription — PaymentIntent-first (Elements)
  // ─────────────────────────────────────────────

  /**
   * Create a PaymentIntent directly for the subscription's initial
   * payment. Unlike the Checkout Session flow, this PaymentIntent
   * has an immediate `client_secret` that the frontend can use
   * with `<Elements>` + `<PaymentElement>`.
   *
   * After the frontend confirms the payment via
   * `stripe.confirmPayment()`, it calls
   * `createSubscriptionFromPayment()` to create the actual Stripe
   * subscription using the confirmed payment method.
   */
  async createSubscriptionPaymentIntent(
    input: BillingSubscriptionPaymentIntentInput,
  ): Promise<BillingSubscriptionPaymentIntentResult> {
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const idempotencyRequest = {
      priceId: input.priceId,
      quantity: input.quantity,
      clientReferenceId: input.clientReferenceId ?? null,
    };
    const reservation = await this.idempotency.reserve({
      key: idempotencyKey,
      scope: 'subscription.payment_intent',
      userId: input.userId,
      request: idempotencyRequest,
    });
    if (!reservation.fresh && reservation.cachedResponse) {
      return reservation.cachedResponse as unknown as BillingSubscriptionPaymentIntentResult;
    }

    const price = await this.loadAndValidatePrice(input.priceId);
    this.assertPriceType(price, BillingPriceType.RECURRING, input.priceId);
    await this.assertPricePlanSellable(price.planId);
    await this.assertNoActiveSubscription(input.userId);

    const customer = await this.customerService.getOrCreateForUser(
      input.userId,
    );

    let payment: BillingPayment | null = null;
    try {
      const amount = price.unitAmount * input.quantity;

      payment = this.paymentRepository.create({
        userId: input.userId,
        billingCustomerId: customer.id,
        priceId: price.id,
        amount,
        currency: price.currency,
        status: BillingPaymentStatus.PENDING,
        description: this.buildSubscriptionDescription(price),
        metadata: {
          source: 'elements',
          kind: 'subscription',
          quantity: input.quantity,
          clientReferenceId: input.clientReferenceId ?? null,
        },
      });
      payment = await this.paymentRepository.save(payment);

      const paymentIntent = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().paymentIntents.create({
          amount,
          currency: price.currency.toLowerCase(),
          customer: customer.stripeCustomerId,
          setup_future_usage: 'off_session',
          metadata: {
            localPaymentId: payment!.id,
            localPriceId: price.id,
            billingCustomerId: customer.id,
            userId: String(input.userId),
            quantity: String(input.quantity),
            clientReferenceId: input.clientReferenceId ?? '',
          },
        }),
      );

      payment.stripePaymentIntentId = paymentIntent.id;
      payment = await this.paymentRepository.save(payment);

      this.eventEmitter.emit(BILLING_EVENTS.CHECKOUT_CREATED, {
        kind: 'subscription_elements',
        userId: input.userId,
        billingCustomerId: customer.id,
        localPaymentId: payment.id,
        paymentIntentId: paymentIntent.id,
      });

      const result: BillingSubscriptionPaymentIntentResult = {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret ?? '',
      };

      await this.idempotency.recordSuccess(
        idempotencyKey,
        result as unknown as Record<string, unknown>,
      );
      return result;
    } catch (err) {
      await this.idempotency.recordFailure(idempotencyKey);
      throw err;
    }
  }

  /**
   * Create the actual Stripe subscription after the frontend has
   * confirmed the PaymentIntent via Stripe Elements.
   *
   * Steps:
   * 1. Retrieve the PaymentIntent from Stripe to verify it succeeded
   * 2. Find the local BillingPayment row
   * 3. Create a subscription on Stripe with the confirmed payment method
   * 4. Save the local BillingSubscription and update BillingPayment
   */
  async createSubscriptionFromPayment(
    input: BillingCreateSubscriptionFromPaymentInput,
  ): Promise<BillingCreateSubscriptionFromPaymentResult> {
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const idempotencyRequest = {
      paymentIntentId: input.paymentIntentId,
    };
    const reservation = await this.idempotency.reserve({
      key: idempotencyKey,
      scope: 'subscription.create_from_payment',
      userId: input.userId,
      request: idempotencyRequest,
    });
    if (!reservation.fresh && reservation.cachedResponse) {
      return reservation.cachedResponse as unknown as BillingCreateSubscriptionFromPaymentResult;
    }

    try {
      // 1. Retrieve the PaymentIntent from Stripe
      const paymentIntent = await this.stripeService.safeCall(() =>
        this.stripeService
          .getClient()
          .paymentIntents.retrieve(input.paymentIntentId),
      );

      // 2. Verify it succeeded
      if (paymentIntent.status !== 'succeeded') {
        throw new InternalServerErrorException(
          `PaymentIntent ${input.paymentIntentId} has status "${paymentIntent.status}". Expected "succeeded".`,
        );
      }

      const paymentMethodId = paymentIntent.payment_method as string | null;
      if (!paymentMethodId) {
        throw new InternalServerErrorException(
          `PaymentIntent ${input.paymentIntentId} has no payment_method. Cannot create subscription.`,
        );
      }

      // 3. Find the local BillingPayment
      const localPayment = await this.paymentRepository.findOne({
        where: { stripePaymentIntentId: input.paymentIntentId },
      });
      if (!localPayment) {
        throw new NotFoundException(
          `BillingPayment with stripePaymentIntentId ${input.paymentIntentId} not found.`,
        );
      }

      // 4. Load the price
      if (!localPayment.priceId) {
        throw new NotFoundException(
          `BillingPayment ${localPayment.id} has no priceId.`,
        );
      }
      const price = await this.catalog.findPriceById(localPayment.priceId);
      if (!price) {
        throw new NotFoundException(
          `BillingPrice ${localPayment.priceId} not found.`,
        );
      }

      const quantity = localPayment.metadata?.quantity
        ? Number(localPayment.metadata.quantity)
        : 1;

      const customer = await this.customerService.getOrCreateForUser(
        input.userId,
      );

      // 5. Check no active subscription (race condition protection)
      await this.assertNoActiveSubscription(input.userId);

      // 6. Create the subscription on Stripe
      const subscription = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().subscriptions.create({
          customer: customer.stripeCustomerId,
          items: [
            {
              price: price.stripePriceId,
              quantity,
            },
          ],
          default_payment_method: paymentMethodId,
          metadata: {
            localPaymentId: localPayment.id,
            localPriceId: price.id,
            billingCustomerId: customer.id,
            userId: String(input.userId),
          },
        }),
      );

      // 7. Save the local BillingSubscription
      // Stripe SDK v22 omits current_period_start/current_period_end from the
      // Subscription type (they're only on SubscriptionItem). The fields still
      // exist in the API response at runtime.
      const subscriptionWithPeriod = subscription as typeof subscription & {
        current_period_start: number | null;
        current_period_end: number | null;
      };

      const localSubscription = this.subscriptionRepository.create({
        userId: input.userId,
        billingCustomerId: customer.id,
        planId: price.planId,
        priceId: price.id,
        stripeSubscriptionId: subscription.id,
        stripeCheckoutSessionId: null,
        status: BillingSubscriptionStatus.ACTIVE,
        currentPeriodStart: subscriptionWithPeriod.current_period_start
          ? new Date(subscriptionWithPeriod.current_period_start * 1000)
          : undefined,
        currentPeriodEnd: subscriptionWithPeriod.current_period_end
          ? new Date(subscriptionWithPeriod.current_period_end * 1000)
          : undefined,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : undefined,
        metadata: {
          source: 'elements',
          localPaymentId: localPayment.id,
          clientReferenceId:
            localPayment.metadata?.clientReferenceId ?? null,
        },
      });
      await this.subscriptionRepository.save(localSubscription);

      // 8. Update the BillingPayment
      localPayment.status = BillingPaymentStatus.SUCCEEDED;
      localPayment.stripeCheckoutSessionId = null; // Not used in this flow
      await this.paymentRepository.save(localPayment);

      this.eventEmitter.emit(BILLING_EVENTS.SUBSCRIPTION_CREATED, {
        userId: input.userId,
        billingCustomerId: customer.id,
        localPaymentId: localPayment.id,
        localSubscriptionId: localSubscription.id,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
      });

      const result: BillingCreateSubscriptionFromPaymentResult = {
        subscriptionId: subscription.id,
        status: subscription.status,
      };

      await this.idempotency.recordSuccess(
        idempotencyKey,
        result as unknown as Record<string, unknown>,
      );
      return result;
    } catch (err) {
      await this.idempotency.recordFailure(idempotencyKey);
      throw err;
    }
  }

  /**
   * Build the placeholder subscription id used while the real
   * Stripe subscription is being created. Exposed for the
   * Phase 5 webhook handler.
   */
  buildSubscriptionPlaceholderId(localPaymentId: string): string {
    return `${SUBSCRIPTION_PENDING_PREFIX}${localPaymentId}`;
  }

  /**
   * True when the given Stripe subscription id is a placeholder
   * produced by this service. Used by the Phase 5 webhook
   * handler to detect rows that need to be updated with the
   * real id.
   */
  isPlaceholderSubscriptionId(stripeSubscriptionId: string): boolean {
    return stripeSubscriptionId.startsWith(SUBSCRIPTION_PENDING_PREFIX);
  }

  // ─────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────

  private async loadAndValidatePrice(priceId: string): Promise<BillingPrice> {
    const direct = await this.catalog.findPriceById(priceId);
    if (!direct) {
      throw new NotFoundException(`Billing price ${priceId} not found.`);
    }
    if (!direct.active) {
      throw new BillingPriceNotActiveError(direct.id);
    }
    return direct;
  }

  private assertPriceType(
    price: BillingPrice,
    expected: BillingPriceType,
    priceId: string,
  ): void {
    if (price.type !== expected) {
      throw new ConflictException(
        `Billing price ${priceId} has type "${price.type}", expected "${expected}".`,
      );
    }
  }

  private async assertPricePlanSellable(planId: string): Promise<void> {
    const plan = await this.planRepository.findOne({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(`Billing plan ${planId} not found.`);
    }
    if (plan.status === BillingPlanStatus.ARCHIVED) {
      throw new ConflictException(
        `Billing plan ${plan.code} is archived and cannot be sold.`,
      );
    }
  }

  private async assertNoActiveSubscription(userId: number): Promise<void> {
    const existing = await this.subscriptionRepository.findOne({
      where: {
        userId,
        status: In(ACTIVE_SUBSCRIPTION_STATES),
      },
    });
    if (
      existing &&
      !this.isPlaceholderSubscriptionId(existing.stripeSubscriptionId)
    ) {
      throw new ConflictException(
        `User ${userId} already has an active subscription ` +
          `(status=${existing.status}, id=${existing.id}). ` +
          `Use the Customer Portal to manage the existing subscription.`,
      );
    }
  }

  private requireConfig(name: string): string {
    const value = this.config.get<string>(name);
    if (!value || value.length === 0) {
      throw new BillingError(
        `${name} is not configured. Checkout redirects cannot be created.`,
      );
    }
    return value;
  }

  private appendSessionId(url: string): string {
    // Stripe replaces the {CHECKOUT_SESSION_ID} placeholder with
    // the actual session id on redirect. If the URL already
    // includes the placeholder we keep it verbatim; otherwise
    // we append `?session_id={CHECKOUT_SESSION_ID}` so the
    // success page can read the id.
    if (url.includes('{CHECKOUT_SESSION_ID}')) {
      return url;
    }
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
  }

  private buildOneTimeDescription(price: BillingPrice): string {
    const formatted = formatMinorAmount(price.unitAmount, price.currency);
    return `One-time payment: ${price.stripePriceId} (${formatted})`;
  }

  private buildSubscriptionDescription(price: BillingPrice): string {
    const formatted = formatMinorAmount(price.unitAmount, price.currency);
    const interval = price.interval ?? 'period';
    return `Subscription: ${price.stripePriceId} (${formatted} / ${interval})`;
  }
}
