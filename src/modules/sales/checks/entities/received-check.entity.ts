import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Estado del cheque recibido en cobro. */
export enum CheckStatus {
  /** En la caja/tesorería, todavía sin depositar. */
  IN_PORTFOLIO = 'IN_PORTFOLIO',
  /** Depositado en el banco, esperando la acreditación. */
  DEPOSITED = 'DEPOSITED',
  /** Acreditado: el dinero está en la cuenta. */
  CASHED = 'CASHED',
  /** Rechazado por el banco (sin fondos, firma, fecha…): corresponde reclamar o emitir nota de débito. */
  REJECTED = 'REJECTED',
}

/** Cheque recibido como medio de pago de una venta (físico o eCheq), con su seguimiento hasta el cobro. */
@Entity('received_checks')
@Index('IDX_received_checks_tenant_status_date', ['tenantId', 'status', 'payDate'])
@Index('IDX_received_checks_sale', ['tenantId', 'saleId'])
@Index('UQ_received_checks_payment', ['tenantId', 'salePaymentId'], { unique: true })
@Index('IDX_received_checks_receipt', ['tenantId', 'receiptId'])
export class ReceivedCheckEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  /** Venta donde se recibió (null si llegó en un recibo de cuenta corriente). */
  @Column({ name: 'sale_id', type: 'varchar', length: 36, nullable: true })
  saleId?: string | null;

  @Column({ name: 'sale_payment_id', type: 'varchar', length: 36, nullable: true })
  salePaymentId?: string | null;

  /** Recibo de cuenta corriente donde se recibió (null si fue en una venta). */
  @Column({ name: 'receipt_id', type: 'varchar', length: 36, nullable: true })
  receiptId?: string | null;

  @Column({ name: 'receipt_payment_id', type: 'varchar', length: 36, nullable: true })
  receiptPaymentId?: string | null;

  /** Cliente que lo entregó (para reclamarle si se rechaza). */
  @Column({ name: 'customer_person_id', type: 'varchar', length: 36, nullable: true })
  customerPersonId?: string | null;

  @Column({ type: 'varchar', length: 80 })
  bank!: string;

  @Column({ type: 'varchar', length: 30 })
  number!: string;

  /** Fecha de cobro (la del cheque; posterior a hoy si es diferido). */
  @Column({ name: 'pay_date', type: 'date' })
  payDate!: string;

  /** Librador (quien firma el cheque) y su CUIT. */
  @Column({ name: 'drawer_name', type: 'varchar', length: 150, nullable: true })
  drawerName?: string | null;

  @Column({ name: 'drawer_tax_id', type: 'varchar', length: 11, nullable: true })
  drawerTaxId?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: CheckStatus, default: CheckStatus.IN_PORTFOLIO })
  status!: CheckStatus;

  @Column({ name: 'status_note', type: 'varchar', length: 300, nullable: true })
  statusNote?: string | null;

  @Column({ name: 'status_changed_at', type: 'timestamp', precision: 6, nullable: true })
  statusChangedAt?: Date | null;

  @Column({ name: 'status_changed_by_user_id', type: 'varchar', length: 36, nullable: true })
  statusChangedByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
