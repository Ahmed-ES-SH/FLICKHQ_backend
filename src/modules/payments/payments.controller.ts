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
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { GetUser } from '../../auth/decorators/current-user.decorator';
import { ListPaginationQueryDto } from '../../common/dto/list-pagination-query.dto';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

interface PaymentHistoryResponse {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent')
  @Throttle({ default: { limit: 2, ttl: 5000 } })
  async createPaymentIntent(
    @GetUser('id') userId: string,
    @Body() dto: CreatePaymentIntentDto,
  ): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
    currency: string;
  }> {
    return this.paymentsService.createPaymentIntent(userId, dto);
  }

  @Post('webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RequestWithRawBody,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    // Get raw body from request - either from NestJS rawBody or express
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    await this.paymentsService.handleWebhook(rawBody, signature);
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
