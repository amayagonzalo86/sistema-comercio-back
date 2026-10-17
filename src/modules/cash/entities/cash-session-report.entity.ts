import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum CashReportType {
  /** Cierre parcial: informa y la caja sigue abierta. */
  X = 'X',
  /** Cierre definitivo: cierra la caja; después se abre una nueva. */
  Z = 'Z',
}

/** Importes por medio de pago o por letra de comprobante. */
export interface CashReportBreakdown {
  key: string;
  count: number;
  amount: string;
}

/** Foto de la caja al momento del cierre (se guarda tal cual: no cambia aunque después haya ajustes). */
export interface CashReportSummary {
  from: string;
  to: string;
  currency: string;
  openingAmount: string;
  sales: { count: number; total: string; discounts: string; tax: string };
  payments: CashReportBreakdown[];
  vouchers: CashReportBreakdown[];
  refunds: { count: number; cash: string };
  movements: {
    sales: string;
    refunds: string;
    incomes: string;
    expenses: string;
    adjustmentsIn: string;
    adjustmentsOut: string;
    count: number;
  };
  expectedCash: string;
  previousX: number;
}

@Entity('cash_session_reports')
@Index('UQ_cash_reports_tenant_key', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('UQ_cash_reports_session_type_number', ['tenantId', 'cashSessionId', 'type', 'number'], { unique: true })
@Index('IDX_cash_reports_tenant_register_type', ['tenantId', 'cashRegisterId', 'type', 'number'])
@Index('IDX_cash_reports_tenant_branch_created', ['tenantId', 'branchId', 'createdAt'])
export class CashSessionReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'cash_register_id', type: 'varchar', length: 36 })
  cashRegisterId!: string;

  @Column({ name: 'cash_session_id', type: 'varchar', length: 36 })
  cashSessionId!: string;

  @Column({ type: 'enum', enum: CashReportType })
  type!: CashReportType;

  /** X: correlativo dentro de la sesión. Z: correlativo de la caja. */
  @Column({ type: 'int' })
  number!: number;

  @Column({ name: 'expected_amount', type: 'decimal', precision: 14, scale: 2 })
  expectedAmount!: string;

  @Column({ name: 'counted_amount', type: 'decimal', precision: 14, scale: 2, nullable: true })
  countedAmount?: string | null;

  @Column({ name: 'difference_amount', type: 'decimal', precision: 14, scale: 2, nullable: true })
  differenceAmount?: string | null;

  @Column({ type: 'json' })
  summary!: CashReportSummary;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
