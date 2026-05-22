import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../types/order-status.enum';

export class OrderItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  productTitleSnapshot: string;

  @ApiProperty({ nullable: true })
  productThumbnailSnapshot: string | null;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  currency: string;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  taxAmount: number;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty({ nullable: true })
  paymentId: string | null;

  @ApiProperty()
  currency: string;

  @ApiProperty({ nullable: true })
  stripeCheckoutSessionId: string | null;

  @ApiProperty({ nullable: true })
  reservationExpiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];
}
