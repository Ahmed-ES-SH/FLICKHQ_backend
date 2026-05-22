import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Must match MAX_CART_QUANTITY in cart.service.ts */
const MAX_CART_QUANTITY = 50;

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_CART_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_CART_QUANTITY)
  quantity: number;
}
