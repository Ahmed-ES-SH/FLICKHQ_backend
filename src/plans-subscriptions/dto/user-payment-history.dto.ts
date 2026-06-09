import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserPaymentHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  amountRefunded: number;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  subscriptionId: string | null;

  @ApiPropertyOptional({ nullable: true })
  invoiceNumber: string | null;

  @ApiProperty()
  transactionType: string;

  @ApiProperty()
  createdAt: Date;
}
