import {
  Controller,
  Post,
  HttpCode,
  Headers,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { StripeInstance } from '../config/stripe.config';
import { SkipThrottle } from '../common/decorators/throttle.decorators';
import {
  UserSubscription,
  SubscriptionStatus,
} from './user-subscription.entity';
import { User } from '../user/schema/user.entity';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';
import { mapStripeStatus } from './utils/status.mapper';
import { Public } from '../auth/decorators/public.decorator';

// ─── Stripe Webhook Event Types ─────────────────────────
// Minimal types to avoid importing Stripe SDK types which don't
// resolve correctly with moduleResolution: "nodenext".

interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: StripeSubscription | StripeInvoice;
  };
}

interface StripeSubscription {
  id: string;
  customer: string | { id: string } | null;
  status: string;
  metadata: Record<string, string>;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      id: string;
      price: {
        id: string;
        unit_amount: number | null;
      } | null;
    }>;
  };
}

interface StripeInvoice {
  id: string;
  customer: string | { id: string } | null;
  subscription: string | { id: string } | null;
  status: string;
  amount_paid: number;
  metadata: Record<string, string>;
}

@Controller('billing/webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: StripeInstance,
    @InjectRepository(UserSubscription)
    private readonly subRepo: Repository<UserSubscription>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post('stripe')
  @Public()
  @HttpCode(200)
  @SkipThrottle()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    if (!sig) throw new BadRequestException('Missing stripe-signature header');

    let event: StripeWebhookEvent;
    try {
      event = this.stripe.webhooks.constructEvent(
        req.rawBody!,
        sig,
        this.config.getOrThrow('STRIPE_WEBHOOK_SECRET'),
      ) as unknown as StripeWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid signature');
    }

    try {
      await this.processEvent(event);
    } catch (err) {
      this.logger.error(
        `Webhook processing error for ${event.type}: ${err}`,
      );
      // Don't throw — return 200 to prevent infinite retries on our bugs
    }

    return { received: true };
  }

  private async processEvent(event: StripeWebhookEvent): Promise<void> {
    this.logger.log(`Processing webhook: ${event.type} (${event.id})`);

    // Deduplication: skip already-processed events (Stripe guarantees at-least-once delivery)
    if (await this.isEventProcessed(event.id)) {
      this.logger.debug(`Skipping duplicate event: ${event.id}`);
      return;
    }
    await this.markEventProcessed(event.id);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.onSubscriptionChanged(event.data.object as StripeSubscription);
        break;

      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as StripeSubscription);
        break;

      case 'invoice.paid':
        await this.onInvoicePaid(event.data.object as StripeInvoice);
        break;

      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event.data.object as StripeInvoice);
        break;

      default:
        this.logger.debug(`Unhandled event: ${event.type}`);
    }
  }

  // ─── Subscription Events ───────────────────────────────

  private async onSubscriptionChanged(
    stripeSub: StripeSubscription,
  ): Promise<void> {
    const userId = stripeSub.metadata?.userId
      ? parseInt(stripeSub.metadata.userId, 10)
      : null;

    if (!userId) {
      this.logger.warn(
        `No userId in subscription metadata for ${stripeSub.id}`,
      );
      return;
    }

    // H6 fix: Preserve existing planCode if metadata doesn't contain one
    // (avoids silently downgrading to 'free' when metadata is missing)
    const metadataPlanCode = stripeSub.metadata?.planCode;

    // Upsert subscription record
    let sub = await this.subRepo.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });

    if (sub) {
      // Update existing — only overwrite planCode if metadata provides one
      sub.status = mapStripeStatus(stripeSub.status);
      if (metadataPlanCode) {
        sub.planCode = metadataPlanCode;
      }
      // H2: Track cancel_at_period_end from Stripe
      sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end ?? false;
      await this.subRepo.save(sub);
    } else {
      // Create new (webhook may arrive before our API response)
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return;

      sub = this.subRepo.create({
        userId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId:
          typeof stripeSub.customer === 'string'
            ? stripeSub.customer
            : stripeSub.customer?.id ?? '',
        status: mapStripeStatus(stripeSub.status),
        planCode: metadataPlanCode ?? 'free',
        stripePriceId: stripeSub.items.data[0]?.price?.id ?? '',
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
      });
      await this.subRepo.save(sub);
    }

    // Emit notifications
    if (sub.status === SubscriptionStatus.ACTIVE) {
      this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_SUCCESS, {
        userId: String(userId),
        paymentId: stripeSub.id,
        amount: stripeSub.items.data[0]?.price?.unit_amount ?? 0,
        title: 'Subscription Updated',
        message: `Your subscription is now ${sub.planCode}.`,
      });
    }
  }

  private async onSubscriptionDeleted(
    stripeSub: StripeSubscription,
  ): Promise<void> {
    const sub = await this.subRepo.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });

    if (sub) {
      sub.status = SubscriptionStatus.CANCELED;
      sub.cancelAtPeriodEnd = false;
      await this.subRepo.save(sub);

      this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_FAILED, {
        userId: String(sub.userId),
        paymentId: stripeSub.id,
        amount: 0,
        reason: 'Subscription canceled',
        title: 'Subscription Ended',
        message: 'Your subscription has been canceled.',
      });
    }
  }

  // ─── Invoice Events (C5 fix) ──────────────────────────
  // Needed for subscription-first flow where `default_incomplete` is used.
  // The subscription starts as `incomplete` until the first invoice is paid.

  private async onInvoicePaid(invoice: StripeInvoice): Promise<void> {
    const subscriptionId = this.resolveSubscriptionId(invoice.subscription);
    if (!subscriptionId) return;

    const sub = await this.subRepo.findOne({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!sub) {
      this.logger.warn(
        `invoice.paid for unknown subscription ${subscriptionId}`,
      );
      return;
    }

    // Transition to ACTIVE on successful payment
    sub.status = SubscriptionStatus.ACTIVE;
    await this.subRepo.save(sub);

    this.logger.log(
      `Invoice ${invoice.id} paid — subscription ${subscriptionId} now ACTIVE`,
    );

    this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_SUCCESS, {
      userId: String(sub.userId),
      paymentId: invoice.id,
      amount: invoice.amount_paid,
      title: 'Payment Received',
      message: `Your subscription (${sub.planCode}) is now active.`,
    });
  }

  private async onInvoicePaymentFailed(invoice: StripeInvoice): Promise<void> {
    const subscriptionId = this.resolveSubscriptionId(invoice.subscription);
    if (!subscriptionId) return;

    const sub = await this.subRepo.findOne({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!sub) {
      this.logger.warn(
        `invoice.payment_failed for unknown subscription ${subscriptionId}`,
      );
      return;
    }

    // Mark as past_due on failed renewal payment
    sub.status = SubscriptionStatus.PAST_DUE;
    await this.subRepo.save(sub);

    this.logger.log(
      `Invoice ${invoice.id} payment failed — subscription ${subscriptionId} now PAST_DUE`,
    );

    this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_FAILED, {
      userId: String(sub.userId),
      paymentId: invoice.id,
      amount: invoice.amount_paid,
      reason: 'Payment failed',
      title: 'Payment Failed',
      message: 'Your subscription payment failed. Please update your payment method.',
    });
  }

  // ─── Helpers ───────────────────────────────────────────

  private resolveSubscriptionId(
    subscription: string | { id: string } | null,
  ): string | null {
    if (!subscription) return null;
    return typeof subscription === 'string' ? subscription : subscription.id;
  }

  // ─── Event Deduplication ───────────────────────────────
  // In-memory Set for dedup — resets on restart, acceptable because
  // Stripe retries webhooks within minutes, not hours.
  // For higher durability, swap to Redis SET or a processed_events table.

  private readonly processedEvents = new Set<string>();

  private async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  private async markEventProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }
}
