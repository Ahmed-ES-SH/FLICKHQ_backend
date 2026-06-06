/**
 * DTOs for the Stripe webhook controller and (in Phase 7) the
 * admin webhook replay endpoint.
 *
 * The controller's only response is the small acknowledgment
 * object below; the heavy lifting happens server-side in
 * `BillingWebhookService`. We intentionally do not echo back any
 * Stripe payload — internal data is not for clients.
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Result kinds the controller can return. The HTTP status is the
 * same in every case (200) — callers (and Stripe) read the kind
 * to understand what happened.
 */
export type BillingWebhookAckKind =
  | 'processed'
  | 'duplicate'
  | 'ignored'
  | 'failed';

export class BillingWebhookAckResponseDto {
  @ApiProperty({
    description: 'High-level outcome of the webhook delivery.',
    enum: ['processed', 'duplicate', 'ignored', 'failed'],
  })
  kind: BillingWebhookAckKind;

  @ApiProperty({
    description: 'The Stripe event id (idempotency key).',
  })
  stripeEventId: string;

  @ApiProperty({
    description: 'The Stripe event type (e.g. customer.subscription.updated).',
  })
  eventType: string;

  @ApiProperty({
    description:
      'Optional explanation. Present for `ignored` and `failed`; absent for `processed` and `duplicate`.',
    required: false,
    nullable: true,
  })
  reason?: string | null;
}

/**
 * Admin replay request — used in Phase 7 to retry a failed event
 * from the admin/support UI. Defined here so the DTO is ready
 * when the route lands.
 */
export class BillingAdminWebhookReplayRequestDto {
  @ApiProperty({
    description: 'The `billing_webhook_events.id` to replay.',
    format: 'uuid',
  })
  eventId: string;
}

export class BillingAdminWebhookReplayResponseDto {
  @ApiProperty({
    description: 'Result of the replay attempt.',
  })
  result: BillingWebhookAckResponseDto;
}
