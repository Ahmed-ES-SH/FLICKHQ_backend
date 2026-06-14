import { ApiProperty } from '@nestjs/swagger';

export class PaymentHistoryDto {
  @ApiProperty({ description: 'Stripe Invoice ID' })
  id: string;

  @ApiProperty({ description: 'Amount paid in cents' })
  amount: number;

  @ApiProperty({ description: 'ISO 4217 currency code' })
  currency: string;

  @ApiProperty({ description: 'Invoice status (paid, open, void, uncollectible)' })
  status: string;

  @ApiProperty({ description: 'Invoice description' })
  description: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  created: Date;

  @ApiProperty({ description: 'URL to the PDF invoice' })
  invoicePdf: string | null;
}
