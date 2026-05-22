import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CheckoutSessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('checkout_session_states')
@Index('idx_checkout_session_user_id', ['userId'], { unique: true })
@Index('idx_checkout_session_stripe_id', ['stripeSessionId'], { unique: true })
export class CheckoutSessionState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @Column({ type: 'varchar', length: 255, name: 'cart_hash' })
  cartHash: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
    name: 'stripe_session_id',
  })
  stripeSessionId: string | null;

  @Column({
    type: 'enum',
    enum: CheckoutSessionStatus,
    default: CheckoutSessionStatus.ACTIVE,
  })
  status: CheckoutSessionStatus;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
