import { IsOptional, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCheckoutSessionDto {
  @ApiPropertyOptional({ description: 'Success redirect URL' })
  @IsOptional()
  @IsUrl()
  successUrl?: string;

  @ApiPropertyOptional({ description: 'Cancel redirect URL' })
  @IsOptional()
  @IsUrl()
  cancelUrl?: string;
}
