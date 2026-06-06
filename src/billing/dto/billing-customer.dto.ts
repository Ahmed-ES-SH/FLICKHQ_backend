/**
 * Response DTO for a `BillingCustomer` row.
 *
 * Exposes only safe, non-secret fields to clients. Stripe customer
 * IDs are safe to expose (they are not secrets), but the underlying
 * `User` object is never included.
 */
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class BillingCustomerResponseDto {
  @ApiProperty({ format: 'uuid' })
  @Expose()
  id: string;

  @ApiProperty({ description: 'Application user id.' })
  @Expose()
  userId: number;

  @ApiProperty({ description: 'Stripe customer id (cus_*).' })
  @Expose()
  stripeCustomerId: string;

  @ApiProperty()
  @Expose()
  email: string;

  @ApiProperty({ nullable: true, required: false })
  @Expose()
  name: string | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
