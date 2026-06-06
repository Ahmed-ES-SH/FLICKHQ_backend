import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { BillingEntitlementSourceType } from '../common/billing.enums';

@Entity('billing_entitlements')
@Index(['userId'])
@Index(['featureKey'])
@Index(['userId', 'featureKey', 'sourceType', 'active'])
export class BillingEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({
    type: 'enum',
    enum: BillingEntitlementSourceType,
    name: 'source_type',
  })
  sourceType: BillingEntitlementSourceType;

  @Column({ type: 'uuid', nullable: true, name: 'source_id' })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 100, name: 'feature_key' })
  featureKey: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'starts_at' })
  startsAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'ends_at' })
  endsAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
