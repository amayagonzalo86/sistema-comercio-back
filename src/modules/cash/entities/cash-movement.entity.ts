import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CashMovementType {
  OPENING = 'OPENING',
  SALE = 'SALE',
  REFUND = 'REFUND',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum CashMovementDirection {
  IN = 'IN',
  OUT = 'OUT',
}

@Entity('cash_movements')
@Index('UQ_cash_movements_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_cash_movements_tenant_session_idempotency', ['tenantId', 'cashSessionId', 'idempotencyKey'], { unique: true })
@Index('IDX_cash_movements_tenant_session_created', ['tenantId', 'cashSessionId', 'createdAt', 'id'])
@Index('IDX_cash_movements_tenant_branch_created', ['tenantId', 'branchId', 'createdAt', 'id'])
export class CashMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'cash_session_id', type: 'varchar', length: 36 })
  cashSessionId!: string;

  @Column({ type: 'enum', enum: CashMovementType })
  type!: CashMovementType;

  @Column({ type: 'enum', enum: CashMovementDirection })
  direction!: CashMovementDirection;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 240 })
  reason!: string;

  // Optional typed source reference (for example SALE or SUPPLIER_PAYMENT); never stores payment credentials.
  @Column({ name: 'source_type', type: 'varchar', length: 40, nullable: true })
  sourceType?: string | null;

  @Column({ name: 'source_id', type: 'varchar', length: 36, nullable: true })
  sourceId?: string | null;

  @Column({ name: 'external_reference', type: 'varchar', length: 100, nullable: true })
  externalReference?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
