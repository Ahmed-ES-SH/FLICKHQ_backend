import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { Payment } from './schema/payment.schema';
import { User } from '../../user/schema/user.schema';
import { StripeProvider } from '../../config/stripe.config';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, User]),
    EventEmitterModule.forRoot(),
    NotificationsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository, StripeProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
