import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  subscriptionId: string | null;

  @ApiPropertyOptional({ nullable: true })
  previousStatus: string | null;

  @ApiProperty()
  newStatus: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  planId: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  priceId: string | null;

  @ApiPropertyOptional({ nullable: true })
  reason: string | null;

  @ApiProperty()
  occurredAt: Date;

  @ApiProperty()
  createdAt: Date;
}
