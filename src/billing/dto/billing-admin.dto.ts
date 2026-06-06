/**
 * DTOs for the Phase 7 minimal admin endpoints:
 *
 * - `GET  /api/billing/admin/overview` — operational snapshot
 * - `GET  /api/billing/admin/webhooks/failed` — failed webhook listing
 * - `POST /api/billing/admin/payments/:id/refund` — refund command
 *
 * The replay request/response DTOs live in `billing-webhook.dto.ts`
 * (they were pre-wired in Phase 5).
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────

export class BillingAdminSubscriptionCountDto {
  @ApiProperty({ description: 'Subscription status value.' })
  status: string;

  @ApiProperty({ description: 'Number of subscriptions in this status.' })
  count: number;
}

export class BillingAdminRecentFailedPaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  description: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class BillingAdminOverviewResponseDto {
  @ApiProperty({ description: 'Total number of billing customers.' })
  totalCustomers: number;

  @ApiProperty({
    description: 'Active subscriptions broken down by status.',
    type: [BillingAdminSubscriptionCountDto],
  })
  subscriptionsByStatus: BillingAdminSubscriptionCountDto[];

  @ApiProperty({
    description: 'Most recent 10 failed payments.',
    type: [BillingAdminRecentFailedPaymentDto],
  })
  recentFailedPayments: BillingAdminRecentFailedPaymentDto[];

  @ApiProperty({
    description: 'Number of webhook events in FAILED status.',
  })
  failedWebhooksCount: number;
}

// ─────────────────────────────────────────────────────────────────
// Failed webhooks
// ─────────────────────────────────────────────────────────────────

export class BillingAdminFailedWebhookDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  stripeEventId: string;

  @ApiProperty()
  eventType: string;

  @ApiProperty({ nullable: true })
  errorMessage: string | null;

  @ApiProperty()
  processingAttempts: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  receivedAt: Date;

  @ApiProperty({ nullable: true })
  processedAt: Date | null;
}

export class BillingAdminListFailedWebhooksResponseDto {
  @ApiProperty({
    type: [BillingAdminFailedWebhookDto],
  })
  data: BillingAdminFailedWebhookDto[];

  @ApiProperty()
  total: number;
}

// ─────────────────────────────────────────────────────────────────
// Refund
// ─────────────────────────────────────────────────────────────────

export class BillingAdminRefundRequestDto {
  @ApiPropertyOptional({
    description:
      'Amount to refund in minor units (cents). Defaults to the full remaining refundable amount. Must be > 0.',
    example: 500,
  })
  amount?: number;
}

export class BillingAdminRefundResponseDto {
  @ApiProperty({
    description: 'Local BillingTransaction id for the refund.',
    format: 'uuid',
  })
  transactionId: string;

  @ApiProperty({
    description: 'Stripe refund id (re_…).',
  })
  stripeRefundId: string;

  @ApiProperty({
    description: 'Amount refunded in minor units.',
  })
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: string;
}
