import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { GetUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/schema/user.entity';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { ChangePlanDto } from './dto/change-plan.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('billing/customer')
  async ensureCustomer(@GetUser() user: User) {
    return this.billingService.ensureCustomer(user);
  }

  @Post('billing/checkout/embedded-elements')
  async createCheckout(
    @GetUser() user: User,
    @Body() dto: CreateCheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.billingService.createCheckoutSession(
      user.id,
      dto.priceId,
      idempotencyKey,
    );
  }

  @Get('subscriptions/current')
  async getCurrentSubscription(@GetUser() user: User) {
    return this.billingService.getCurrentSubscription(user.id);
  }

  @Get('subscriptions/history')
  async getSubscriptionHistory(@GetUser() user: User) {
    return this.billingService.getSubscriptionHistory(user.id);
  }

  @Get('payments/history')
  async getPaymentHistory(@GetUser() user: User) {
    return this.billingService.getPaymentHistory(user.id);
  }

  @Post('subscriptions/cancel')
  async cancelSubscription(@GetUser() user: User) {
    return this.billingService.cancelSubscription(user.id);
  }

  @Post('subscriptions/change-plan')
  async changePlan(
    @GetUser() user: User,
    @Body() dto: ChangePlanDto,
  ) {
    return this.billingService.changePlan(user.id, dto.priceId);
  }
}
