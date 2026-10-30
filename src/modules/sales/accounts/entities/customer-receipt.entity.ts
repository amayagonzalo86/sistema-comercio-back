import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Medios con que se cobra un recibo de cuenta corriente. */
export enum ReceiptPaymentMethod {
  CASH = 'CASH',
  DEBIT_CARD = 'DEBIT_CARD',
  CREDIT_CARD = 'CREDIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  QR = 'QR',
  CHECK = 'CHECK',
  OTHER = 'OTHER',
}

/** Recibo de cobranza de cuenta corriente (numerado por empresa; no es comprobante fiscal). */
@Entity('customer_receipts')
@Index('UQ_customer_receipts_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('UQ_customer_receipts_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_customer_receipts_customer', ['tenantId', 'customerPersonId', 'createdAt'])
@Index('IDX_customer_receipts_session', ['tenantId', 'cashSessionId'])
export class CustomerReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36 })
  customerPersonId!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Caja donde se cobró (la del efectivo o la abierta en el puesto): el cierre X/Z suma la cobranza. */
  @Column({ name: 'cash_session_id', type: 'varchar', length: 36, nullable: true })
  cashSessionId?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
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

@Entity('customer_receipt_payments')
@Index('IDX_customer_receipt_payments_receipt', ['tenantId', 'receiptId'])
export class CustomerReceiptPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'receipt_id', type: 'varchar', length: 36 })
  receiptId!: string;

  /** Orden en el recibo (como lo cargó el cajero). */
  @Column({ type: 'smallint', unsigned: true, default: 0 })
  position!: number;

  @Column({ type: 'enum', enum: ReceiptPaymentMethod })
  method!: ReceiptPaymentMethod;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  /** N.º de transferencia, cupón de tarjeta u operación. */
  @Column({ name: 'external_reference', type: 'varchar', length: 100, nullable: true })
  externalReference?: string | null;
}
