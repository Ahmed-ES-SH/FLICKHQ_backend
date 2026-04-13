import { IsString, IsIn, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ProductType = 'premium_monthly' | 'premium_yearly';

export class CreatePaymentIntentDto {
  @ApiProperty({
    enum: ['premium_monthly', 'premium_yearly'],
    description: 'Product type - amount is validated server-side',
    example: 'premium_monthly',
  })
  @IsString()
  @IsIn(['premium_monthly', 'premium_yearly'])
  productType: ProductType;

  @ApiPropertyOptional({
    description: 'Optional custom description for the payment',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
