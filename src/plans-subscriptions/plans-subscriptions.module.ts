import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UserModule } from '../user/user.module';
import { BillingPlan } from '../billing/entities/billing-plan.entity';
import { BillingPrice } from '../billing/entities/billing-price.entity';
import { BillingSubscription } from '../billing/entities/billing-subscription.entity';
import { BillingPayment } from '../billing/entities/billing-payment.entity';
import { BillingInvoice } from '../billing/entities/billing-invoice.entity';
import { BillingTransaction } from '../billing/entities/billing-transaction.entity';
import { PlanSubscriptionHistory } from './entities/plan-subscription-history.entity';

import { PlanManagementService } from './services/plan-management.service';
import { PriceManagementService } from './services/price-management.service';
import { PlanDisplayService } from './services/plan-display.service';
import { SubscriptionHistoryService } from './services/subscription-history.service';
import { UserBillingHistoryService } from './services/user-billing-history.service';

import { AdminPlansController } from './controllers/admin-plans.controller';
import { PublicPlansController } from './controllers/public-plans.controller';
import { UserSubscriptionsController } from './controllers/user-subscriptions.controller';
import { UserPaymentsController } from './controllers/user-payments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanSubscriptionHistory,
      BillingPlan,
      BillingPrice,
      BillingSubscription,
      BillingPayment,
      BillingInvoice,
      BillingTransaction,
    ]),
    BillingModule,
    UserModule,
  ],
  controllers: [
    AdminPlansController,
    PublicPlansController,
    UserSubscriptionsController,
    UserPaymentsController,
  ],
  providers: [
    PlanManagementService,
    PriceManagementService,
    PlanDisplayService,
    SubscriptionHistoryService,
    UserBillingHistoryService,
  ],
  exports: [SubscriptionHistoryService],
})
export class PlansSubscriptionsModule {}
