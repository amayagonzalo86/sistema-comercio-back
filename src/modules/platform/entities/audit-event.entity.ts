import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantEntity } from './tenant.entity';

@Entity('audit_events')
@Index('IDX_audit_tenant_time', ['tenantId', 'createdAt'])
@Index('IDX_audit_tenant_aggregate', ['tenantId', 'aggregateType', 'aggregateId', 'createdAt'])
@Index('IDX_audit_request', ['requestId'])
export class AuditEventEntity {
  // Monotonic keys reduce index fragmentation for a high-write append-only table.
  @PrimaryGeneratedColumn('increment', { type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36, nullable: true })
  actorUserId?: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 80 })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 100 })
  aggregateId!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 100, nullable: true })
  requestId?: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent?: string | null;

  // Store only approved, non-secret audit fields. Never persist passwords or tokens here.
  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
