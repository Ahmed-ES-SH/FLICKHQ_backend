import {
  Injectable,
  Inject,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Stripe from 'stripe';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaymentsRepository } from './payments.repository';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentStatus } from './schema/payment.schema';
import { User } from '../../user/schema/user.entity';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';
import {
  NotificationsGateway,
  PaymentStatusPayload,
} from '../../notifications/notifications.gateway';
import { getProductPrice } from '../../config/pricing.config';
import {
  StripeWebhookEvent,
  StripePaymentIntent,
  StripeCharge,
  isPaymentIntent,
  isCharge,
} from './types/stripe.types';

// Get proper Stripe instance type
type StripeInstance = InstanceType<typeof Stripe>;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject('STRIPE_CLIENT')
    private readonly stripeClient: StripeInstance,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    @Inject(NotificationsGateway)
    private readonly notificationsGateway: NotificationsGateway,
  ) {}
  async createPaymentIntent(
    userId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
    currency: string;
  }> {
    // Validate product type server-side - NEVER trust client amount
    const pricing = getProductPrice(dto.productType);
    if (!pricing) {
      throw new BadRequestException('Invalid product type');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find user
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId as unknown as number },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Use server-defined price, not client-sent amount
      const amount = pricing.amount;
      const currency = pricing.currency;

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
        return {
          clientSecret: 'existing',
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

      // Persist payment record
      const payment = await this.paymentsRepository.create({
        userId: user.id.toString(),
        stripePaymentIntent: paymentIntent.id,
        amount: pricing.amount,
        currency: pricing.currency,
        status: PaymentStatus.PENDING,
        description: dto.description || pricing.description,
        idempotencyKey,
        metadata: { userId: user.id.toString(), productType: dto.productType },
      });

      await queryRunner.commitTransaction();

      return {
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
    } catch (error) {
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
    }
  }

  /**
   * Get paginated payment history for user
   */
  async getPaymentHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
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

    for (const payment of stalePayments) {
      try {
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
      } catch (error) {
        console.error(`Failed to reconcile payment ${payment.id}:`, error);
      }
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
        console.warn(
          `Payment record not found for intent ${paymentIntent.id}, but marking user as premium`,
        );
        // Still mark user as premium if customer exists
        const userId = paymentIntent.metadata?.userId;
        if (userId) {
          await queryRunner.manager.update(User, userId, {
            isPremium: true,
          });
        }
        await queryRunner.commitTransaction();
        return;
      }

      // Update payment status
      await queryRunner.manager.update('payments', payment.id, {
        status: PaymentStatus.SUCCEEDED,
        stripeChargeId: paymentIntent.latest_charge as string | null,
      });

      // Update user premium status
      await queryRunner.manager.update(User, payment.userId, {
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
      console.error(
        `Failed to handle payment intent succeeded for ${paymentIntent.id}:`,
        error,
      );
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
      console.warn(
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
      console.warn(`Payment record not found for refunded charge ${charge.id}`);
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update payment status
      await queryRunner.manager.update('payments', payment.id, {
        status: PaymentStatus.REFUNDED,
      });

      // Optionally revoke premium
      await queryRunner.manager.update(User, payment.userId, {
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
      console.error(
        `Failed to handle charge refunded for ${charge.id}:`,
        error,
      );
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
