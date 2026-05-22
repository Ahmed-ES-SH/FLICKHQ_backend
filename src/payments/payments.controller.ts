import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
  InternalServerErrorException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { GetUser } from '../auth/decorators/current-user.decorator';
import { ListPaginationQueryDto } from '../common/dto/list-pagination-query.dto';
import { Payment } from './schema/payment.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

interface PaymentHistoryResponse {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async createPaymentIntent(
    @GetUser('id') userId: string,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.paymentsService.createPaymentIntent(userId, dto);
  }

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create Stripe Checkout Session from cart' })
  @ApiResponse({ status: 201, description: 'Checkout session created' })
  async createCheckoutSession(
    @GetUser('id') userId: number,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.paymentsService.createCheckoutSession(userId.toString(), dto);
  }

  @Post('webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RequestWithRawBody,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    // rawBody must be set by a global middleware (e.g., body-parser with verify).
    // Falling back to JSON.stringify would produce a different byte representation
    // than what Stripe signed, causing signature verification to fail.
    if (!req.rawBody) {
      throw new InternalServerErrorException(
        'rawBody is not available — ensure body-parser verify middleware is configured',
      );
    }
    await this.paymentsService.handleWebhook(req.rawBody, signature);
    return { received: true };
  }

  @Get('history')
  async getPaymentHistory(
    @GetUser('id') userId: string,
    @Query() pagination: ListPaginationQueryDto,
  ): Promise<PaymentHistoryResponse> {
    return this.paymentsService.getPaymentHistory(
      userId,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }
}
