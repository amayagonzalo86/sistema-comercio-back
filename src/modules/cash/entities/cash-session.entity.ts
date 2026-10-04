import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CashSessionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity('cash_sessions')
@Index('UQ_cash_sessions_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_cash_sessions_tenant_branch_id', ['tenantId', 'branchId', 'id'], { unique: true })
@Index('UQ_cash_sessions_tenant_opening_key', ['tenantId', 'openingIdempotencyKey'], { unique: true })
@Index('UQ_cash_sessions_one_open_per_register', ['tenantId', 'openRegisterId'], { unique: true })
@Index('IDX_cash_sessions_tenant_branch_status', ['tenantId', 'branchId', 'status', 'openedAt'])
@Index('IDX_cash_sessions_tenant_register_opened', ['tenantId', 'cashRegisterId', 'openedAt'])
export class CashSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'cash_register_id', type: 'varchar', length: 36 })
  cashRegisterId!: string;

  // MySQL stores a generated NULL for closed sessions, permitting many historical sessions
  // while the unique index enforces one open session per register.
  @Column({
    name: 'open_register_id',
    type: 'varchar',
    length: 36,
    nullable: true,
    asExpression: "CASE WHEN `status` = 'OPEN' THEN `cash_register_id` ELSE NULL END",
    generatedType: 'STORED',
  })
  openRegisterId?: string | null;

  @Column({ type: 'enum', enum: CashSessionStatus, default: CashSessionStatus.OPEN })
  status!: CashSessionStatus;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'opening_amount', type: 'decimal', precision: 14, scale: 2 })
  openingAmount!: string;

  @Column({ name: 'expected_amount', type: 'decimal', precision: 14, scale: 2, nullable: true })
  expectedAmount?: string | null;

  @Column({ name: 'counted_amount', type: 'decimal', precision: 14, scale: 2, nullable: true })
  countedAmount?: string | null;

  @Column({ name: 'difference_amount', type: 'decimal', precision: 14, scale: 2, nullable: true })
  differenceAmount?: string | null;

  @Column({ name: 'opening_idempotency_key', type: 'varchar', length: 100 })
  openingIdempotencyKey!: string;

  @Column({ name: 'opened_by_user_id', type: 'varchar', length: 36 })
  openedByUserId!: string;

  @Column({ name: 'closed_by_user_id', type: 'varchar', length: 36, nullable: true })
  closedByUserId?: string | null;

  @Column({ name: 'opened_at', type: 'timestamp', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  openedAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamp', precision: 6, nullable: true })
  closedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
