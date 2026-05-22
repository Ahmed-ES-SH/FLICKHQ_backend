import {
  Injectable,
  Inject,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Stripe from 'stripe';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { StripeInstance } from '../config/stripe.config';
import { PaymentsRepository } from './payments.repository';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { Payment } from './schema/payment.schema';
import { PaymentStatus } from './schema/payment-status.enum';
import { PaymentType } from './types/payment-type.enum';
import { User } from '../user/schema/user.entity';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { getProductPrice } from '../config/pricing.config';
import { OrderService } from '../orders/order.service';
import { CartService } from '../cart/cart.service';
import {
  StripeWebhookEvent,
  StripePaymentIntent,
  StripeCharge,
  StripeCheckoutSession,
  isPaymentIntent,
  isCharge,
  isCheckoutSession,
} from './types/stripe.types';

export interface PaymentHistoryResponse {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExistingPaymentResponse {
  isExisting: true;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

export interface NewPaymentIntentResponse {
  isExisting: false;
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject('STRIPE_CLIENT')
    private readonly stripeClient: StripeInstance,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    @Inject(NotificationsGateway)
    private readonly notificationsGateway: NotificationsGateway,
    private readonly orderService: OrderService,
    private readonly cartService: CartService,
  ) {}

  async createPaymentIntent(
    userId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<NewPaymentIntentResponse | ExistingPaymentResponse> {
    // Validate product type server-side - NEVER trust client amount
    const pricing = getProductPrice(dto.productType);
    if (!pricing) {
      throw new BadRequestException('Invalid product type');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find user — User.id is numeric (auto-increment)
      const userNumericId = parseInt(userId, 10);
      if (isNaN(userNumericId)) {
        throw new BadRequestException('Invalid user ID');
      }

      const user = await queryRunner.manager.findOne(User, {
        where: { id: userNumericId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Use server-defined price, not client-sent amount
      // pricing.amount and pricing.currency used below for Stripe API call

      // Generate idempotency key (userId + productType + day)
      const idempotencyKey = createHash('sha256')
        .update(
          `${userId}:${dto.productType}:${new Date().toISOString().slice(0, 10)}`,
        )
        .digest('hex');

      // Check for existing payment with same idempotency key
      const existing =
        await this.paymentsRepository.findByIdempotencyKey(idempotencyKey);

      if (existing && existing.status === PaymentStatus.PENDING) {
        await queryRunner.commitTransaction();
        return {
          isExisting: true,
          paymentIntentId: existing.stripePaymentIntent,
          amount: existing.amount,
          currency: existing.currency,
        };
      }

      // Find or create Stripe customer
      let stripeCustomerId = user.stripeCustomerId;

      if (!stripeCustomerId) {
        const customer = await this.stripeClient.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { userId: user.id.toString() },
        });
        stripeCustomerId = customer.id;

        await queryRunner.manager.update(User, user.id, {
          stripeCustomerId,
        });
      }

      // Create Stripe payment intent using server-defined price
      const paymentIntent = await this.stripeClient.paymentIntents.create({
        amount: pricing.amount,
        currency: pricing.currency,
        customer: stripeCustomerId,
        description: dto.description || pricing.description,
        metadata: { userId: user.id.toString(), productType: dto.productType },
      });

      // Persist payment record (within transaction)
      const payment = await this.paymentsRepository.create(
        {
          userId: user.id.toString(),
          stripePaymentIntent: paymentIntent.id,
          amount: pricing.amount,
          currency: pricing.currency,
          status: PaymentStatus.PENDING,
          description: dto.description || pricing.description,
          idempotencyKey,
          metadata: {
            userId: user.id.toString(),
            productType: dto.productType,
          },
        },
        queryRunner,
      );

      await queryRunner.commitTransaction();

      return {
        isExisting: false,
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
        amount: payment.amount,
        currency: payment.currency,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException) throw error;
      if (error instanceof Stripe.errors.StripeError) {
        throw new BadRequestException(error.message);
      }
      throw new InternalServerErrorException('Failed to create payment intent');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Create a Stripe Checkout Session from the user's cart.
   * Atomic: order creation + Stripe session + status transition in one transaction.
   */
  async createCheckoutSession(
    userId: string,
    dto: CreateCheckoutSessionDto,
  ): Promise<{ checkoutUrl: string; orderId: string; sessionId: string }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Validate cart
      const cartValidation =
        await this.cartService.validateCartForCheckout(userId);
      if (!cartValidation.isValid) {
        throw new BadRequestException(cartValidation.errors.join(', '));
      }

      // 2. Create order from cart (AWAITING_CHECKOUT_SESSION)
      const order = await this.orderService.createOrderFromCart(
        userId,
        cartValidation.cart!,
        queryRunner,
      );

      // 3. Create Stripe Checkout Session
      const cart = cartValidation.cart!;
      const lineItems = cart.items.map((item) => ({
        price_data: {
          currency: cart.currency,
          product_data: {
            name: item.productTitle,
            images: item.productThumbnail ? [item.productThumbnail] : [],
            metadata: { productId: item.productId },
          },
          unit_amount: item.unitPrice,
        },
        quantity: item.quantity,
      }));

      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ??
        'http://localhost:3000';
      const successUrl =
        dto.successUrl ??
        `${frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = dto.cancelUrl ?? `${frontendUrl}/payment/cancel`;

      const session = await this.stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          orderId: order.id,
          userId,
        },
        expires_at: Math.floor(Date.now() / 1000) + 20 * 60, // 20 minutes
      });

      // 4. Mark order as PENDING_PAYMENT (within same transaction)
      await this.orderService.markOrderPendingPayment(
        order.id,
        session.id,
        queryRunner,
      );

      await queryRunner.commitTransaction();

      return {
        checkoutUrl: session.url!,
        orderId: order.id,
        sessionId: session.id,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Failed to create checkout session',
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'STRIPE_WEBHOOK_SECRET is not configured',
      );
    }

    let event: StripeWebhookEvent;

    try {
      event = this.stripeClient.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      ) as StripeWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        const data = event.data.object;
        if (isPaymentIntent(data)) {
          if (event.type === 'payment_intent.succeeded') {
            await this.handlePaymentIntentSucceeded(data);
          } else {
            await this.handlePaymentIntentFailed(data);
          }
        }
        break;
      }
      case 'charge.refunded': {
        const data = event.data.object;
        if (isCharge(data)) {
          await this.handleChargeRefunded(data);
        }
        break;
      }
      case 'checkout.session.completed': {
        const data = event.data.object;
        if (isCheckoutSession(data)) {
          await this.handleCheckoutSessionCompleted(data);
        }
        break;
      }
    }
  }

  /**
   * Get paginated payment history for user
   */
  async getPaymentHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaymentHistoryResponse> {
    const skip = (page - 1) * limit;
    const [data, total] = await this.paymentsRepository.findByUser(
      userId,
      skip,
      limit,
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Reconcile stale pending payments (cron job)
   * Note: This is now handled by JobsService for better separation of concerns
   * Kept as placeholder in case manual trigger is needed
   */
  async reconcilePendingPaymentsManually(): Promise<void> {
    const stalePayments =
      await this.paymentsRepository.findStalePendingPayments();

    // Use Promise.allSettled for parallel reconciliation instead of sequential loop
    const results = await Promise.allSettled(
      stalePayments.map((payment) => this.reconcileSinglePayment(payment)),
    );

    // Log any failures
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to reconcile payment ${stalePayments[i]!.id}`,
          (result.reason as Error).stack,
        );
      }
    });
  }

  /**
   * Reconcile a single stale payment — extracted for parallelization
   */
  private async reconcileSinglePayment(payment: Payment): Promise<void> {
    const intent = await this.stripeClient.paymentIntents.retrieve(
      payment.stripePaymentIntent,
    );

    // Convert Stripe response to our interface type
    const paymentData: StripePaymentIntent = {
      id: intent.id,
      object: 'payment_intent',
      status: intent.status,
      metadata: intent.metadata,
      latest_charge:
        typeof intent.latest_charge === 'string'
          ? intent.latest_charge
          : intent.latest_charge
            ? (intent.latest_charge as unknown as { id: string }).id
            : null,
    };

    if (paymentData.status === 'succeeded') {
      await this.handlePaymentIntentSucceeded(paymentData);
    } else if (
      paymentData.status === 'canceled' ||
      paymentData.status === 'requires_payment_method'
    ) {
      await this.markPaymentFailed(payment.id, 'Payment timed out');
    }
  }

  // Private handlers

  private async handlePaymentIntentSucceeded(
    paymentIntent: StripePaymentIntent | StripeCharge,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const payment = await this.paymentsRepository.findByStripePaymentIntent(
        paymentIntent.id,
      );

      if (!payment) {
        // Do NOT activate premium without a matching local payment record.
        // This prevents replay attacks where a crafted webhook with a userId
        // in metadata could grant free premium access.
        this.logger.warn(
          `Payment record not found for intent ${paymentIntent.id}. Skipping premium activation to prevent replay attacks.`,
        );
        await queryRunner.commitTransaction();
        return;
      }

      // Update payment status
      await queryRunner.manager.update(Payment, payment.id, {
        status: PaymentStatus.SUCCEEDED,
        stripeChargeId:
          (paymentIntent.latest_charge as string | null) ?? undefined,
      });

      // Update user premium status
      await queryRunner.manager.update(User, parseInt(payment.userId, 10), {
        isPremium: true,
      });

      await queryRunner.commitTransaction();

      // Emit notification event (outside transaction)
      this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_SUCCESS, {
        userId: payment.userId,
        paymentId: payment.id,
        amount: payment.amount,
        title: 'Payment Successful',
        message: `Your payment of $${(payment.amount / 100).toFixed(2)} was successful. Premium access activated.`,
      });

      // Emit payment status socket event
      const successPayload = {
        status: 'succeeded' as const,
        amount: payment.amount,
        description: payment.description || 'Premium access',
      };
      await this.notificationsGateway.emitPaymentStatus(
        payment.userId,
        successPayload,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to handle payment intent succeeded for ${paymentIntent.id}`,
        (error as Error).stack,
      );
      // Re-throw so Stripe retries the webhook
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async handlePaymentIntentFailed(
    paymentIntent: StripePaymentIntent | StripeCharge,
  ): Promise<void> {
    const payment = await this.paymentsRepository.findByStripePaymentIntent(
      paymentIntent.id,
    );

    if (!payment) {
      this.logger.warn(
        `Payment record not found for failed intent ${paymentIntent.id}`,
      );
      return;
    }

    await this.markPaymentFailed(
      payment.id,
      paymentIntent.last_payment_error?.message || 'Payment failed',
    );

    // Emit notification event
    this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_FAILED, {
      userId: payment.userId,
      paymentId: payment.id,
      amount: payment.amount,
      reason: paymentIntent.last_payment_error?.message || 'Payment failed',
      title: 'Payment Failed',
      message: `Your payment of $${(payment.amount / 100).toFixed(2)} failed. Please try again.`,
    });

    // Emit payment status socket event
    const failedPayload = {
      status: 'failed' as const,
      amount: payment.amount,
      description:
        paymentIntent.last_payment_error?.message || 'Payment failed',
    };
    await this.notificationsGateway.emitPaymentStatus(
      payment.userId,
      failedPayload,
    );
  }

  private async handleChargeRefunded(charge: StripeCharge): Promise<void> {
    const payment = await this.paymentsRepository.findByStripePaymentIntent(
      charge.payment_intent as string,
    );

    if (!payment) {
      this.logger.warn(
        `Payment record not found for refunded charge ${charge.id}`,
      );
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update payment status
      await queryRunner.manager.update(Payment, payment.id, {
        status: PaymentStatus.REFUNDED,
      });

      // Revoke premium
      await queryRunner.manager.update(User, parseInt(payment.userId, 10), {
        isPremium: false,
      });

      await queryRunner.commitTransaction();

      // Emit payment status socket event for refund
      const refundPayload = {
        status: 'refunded' as const,
        amount: payment.amount,
        description: payment.description || 'Payment refunded',
      };
      await this.notificationsGateway.emitPaymentStatus(
        payment.userId,
        refundPayload,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to handle charge refunded for ${charge.id}`,
        (error as Error).stack,
      );
      // Re-throw so Stripe retries the webhook
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Handle checkout.session.completed — the primary Stripe Checkout success event.
   * Creates payment record, marks order as PAID, clears cart, emits notifications.
   */
  private async handleCheckoutSessionCompleted(
    session: StripeCheckoutSession,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const orderId = session.metadata?.orderId;
      if (!orderId) {
        this.logger.warn(
          'Checkout session completed without orderId metadata',
          {
            sessionId: session.id,
          },
        );
        await queryRunner.commitTransaction();
        return;
      }

      const userId = session.metadata?.userId;
      if (!userId) {
        this.logger.warn('Checkout session completed without userId metadata', {
          sessionId: session.id,
        });
        await queryRunner.commitTransaction();
        return;
      }

      // Find or create payment record
      let payment = await this.paymentsRepository.findByStripePaymentIntent(
        session.payment_intent as string,
      );

      if (!payment && session.amount_total) {
        // Create payment record from session data (first-time checkout)
        payment = await this.paymentsRepository.create(
          {
            userId,
            stripePaymentIntent: session.payment_intent,
            amount: session.amount_total,
            currency: session.currency || 'usd',
            status: PaymentStatus.SUCCEEDED,
            stripeCheckoutSessionId: session.id,
            orderId,
            paymentType: PaymentType.ECOMMERCE,
            metadata: { checkoutSessionId: session.id },
          },
          queryRunner,
        );
      } else if (payment) {
        // Update existing payment record
        await this.paymentsRepository.updateStatus(
          payment.id,
          PaymentStatus.SUCCEEDED,
          { stripeCheckoutSessionId: session.id },
          queryRunner,
        );
        // Re-fetch to get updated entity
        payment = await this.paymentsRepository.findByStripePaymentIntent(
          session.payment_intent as string,
        );
      }

      // Mark order as PAID (uses pessimistic lock)
      if (payment) {
        await this.orderService.markOrderPaidWithLock(
          orderId,
          payment.id,
          queryRunner,
        );
      }

      await queryRunner.commitTransaction();

      // Emit notifications (outside transaction)
      if (payment) {
        this.eventEmitter.emit(NOTIFICATION_EVENTS.PAYMENT_SUCCESS, {
          userId: payment.userId,
          paymentId: payment.id,
          amount: payment.amount,
          title: 'Payment Successful',
          message: `Your payment of $${(payment.amount / 100).toFixed(2)} was successful.`,
        });

        await this.notificationsGateway.emitPaymentStatus(payment.userId, {
          status: 'succeeded' as const,
          amount: payment.amount,
          description: 'Order payment successful',
        });

        // Clear user's cart after successful payment (idempotent)
        await this.cartService.clearCart(userId);
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to handle checkout session completed for ${session.id}`,
        (error as Error).stack,
      );
      throw error; // Re-throw so Stripe retries
    } finally {
      await queryRunner.release();
    }
  }

  private async markPaymentFailed(
    paymentId: string,
    reason: string,
  ): Promise<void> {
    await this.paymentsRepository.updateStatus(
      paymentId,
      PaymentStatus.FAILED,
      {
        metadata: { failureReason: reason },
      },
    );
  }
}
