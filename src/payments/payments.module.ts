import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { Payment } from './schema/payment.schema';
import { User } from '../user/schema/user.entity';
import { StripeProvider } from '../config/stripe.config';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderModule } from '../orders/order.module';
import { CartModule } from '../cart/cart.module';
import { CheckoutSessionState } from './schema/checkout-session-state.schema';
import { OutboxEvent } from './schema/outbox-event.schema';
import { Refund } from './schema/refund.schema';
import { WebhookEvent } from './schema/webhook-event.schema';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      User,
      CheckoutSessionState,
      OutboxEvent,
      Refund,
      WebhookEvent,
    ]),
    NotificationsModule,
    OrderModule,
    CartModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository, StripeProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
