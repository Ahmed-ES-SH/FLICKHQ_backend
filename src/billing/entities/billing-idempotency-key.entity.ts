import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { BillingIdempotencyStatus } from '../common/billing.enums';

@Entity('billing_idempotency_keys')
@Index(['key'], { unique: true })
@Index(['scope'])
@Index(['userId'])
@Index(['expiresAt'])
export class BillingIdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'varchar', length: 100 })
  scope: string;

  @Column({ type: 'int', nullable: true, name: 'user_id' })
  userId: number | null;

  @Column({ type: 'varchar', length: 255, name: 'request_hash' })
  requestHash: string;

  @Column({ type: 'jsonb', nullable: true, name: 'response_snapshot' })
  responseSnapshot: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: BillingIdempotencyStatus,
    default: BillingIdempotencyStatus.IN_PROGRESS,
  })
  status: BillingIdempotencyStatus;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
