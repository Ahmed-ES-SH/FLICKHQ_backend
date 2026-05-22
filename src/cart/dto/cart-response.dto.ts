import { ApiProperty } from '@nestjs/swagger';

export class CartItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  productTitle: string;

  @ApiProperty({ nullable: true })
  productThumbnail: string | null;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  availableStock: number;
}

export class CartResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  currency: string;
}
