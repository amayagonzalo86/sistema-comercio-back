import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Movimiento de la cuenta corriente de un cliente. */
export enum AccountEntryKind {
  /** Venta a cuenta corriente (la parte pagada con el medio ACCOUNT). */
  SALE = 'SALE',
  /** Nota de débito pendiente de cobro (intereses, cheque rechazado, diferencia de precio). */
  DEBIT_NOTE = 'DEBIT_NOTE',
  /** Nota de crédito a favor del cliente (bonificación sin reintegro). */
  CREDIT_NOTE = 'CREDIT_NOTE',
  /** Devolución de mercadería con reintegro "a cuenta del cliente". */
  RETURN = 'RETURN',
  /** Recibo de cobranza. */
  RECEIPT = 'RECEIPT',
}

/** DEBIT = el cliente debe (aumenta el saldo); CREDIT = paga o se le acredita (lo reduce). */
export enum AccountEntryDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/**
 * Libro de la cuenta corriente del cliente. Saldo = débitos − créditos.
 * Cada débito tiene su vencimiento y lo cancelado (amountApplied); cada crédito, cuánto ya se imputó.
 * Las imputaciones (qué recibo o nota cancela qué factura) están en customer_account_allocations.
 * amountApplied se modifica solo con la fila del cliente bloqueada (FOR UPDATE sobre persons).
 */
@Entity('customer_account_entries')
@Index('IDX_account_entries_customer', ['tenantId', 'customerPersonId', 'createdAt'])
@Index('IDX_account_entries_customer_due', ['tenantId', 'customerPersonId', 'direction', 'dueDate'])
@Index('UQ_account_entries_source', ['tenantId', 'sourceType', 'sourceId'], { unique: true })
export class CustomerAccountEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36 })
  customerPersonId!: string;

  @Column({ type: 'enum', enum: AccountEntryKind })
  kind!: AccountEntryKind;

  @Column({ type: 'enum', enum: AccountEntryDirection })
  direction!: AccountEntryDirection;

  /** Origen: SALE_PAYMENT, SALE_ADJUSTMENT, SALE_RETURN o CUSTOMER_RECEIPT. */
  @Column({ name: 'source_type', type: 'varchar', length: 30 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'varchar', length: 36 })
  sourceId!: string;

  /** Venta relacionada (para mostrar el comprobante y emitir notas de débito por intereses). */
  @Column({ name: 'sale_id', type: 'varchar', length: 36, nullable: true })
  saleId?: string | null;

  @Column({ type: 'varchar', length: 200 })
  description!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  /** Débitos: lo ya cobrado. Créditos: lo ya imputado a débitos. */
  @Column({ name: 'amount_applied', type: 'decimal', precision: 14, scale: 2, default: 0 })
  amountApplied!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Solo débitos: vencimiento (fecha de la venta + plazo del cliente). */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string | null;

  /** Solo débitos: hasta qué día ya se facturaron intereses por mora (para no cobrarlos dos veces). */
  @Column({ name: 'interest_through', type: 'date', nullable: true })
  interestThrough?: string | null;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}

/** Imputación: un crédito (recibo, nota de crédito, devolución) cancela parte de un débito. */
@Entity('customer_account_allocations')
@Index('IDX_account_allocations_debit', ['tenantId', 'debitEntryId'])
@Index('IDX_account_allocations_credit', ['tenantId', 'creditEntryId'])
export class CustomerAccountAllocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'credit_entry_id', type: 'varchar', length: 36 })
  creditEntryId!: string;

  @Column({ name: 'debit_entry_id', type: 'varchar', length: 36 })
  debitEntryId!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}

/**
 * Autorización del encargado para que una venta a cuenta supere el límite o se haga con deuda vencida.
 * Vale para una sola venta, hasta el importe indicado y hasta el fin del día.
 */
@Entity('customer_credit_authorizations')
@Index('IDX_credit_authorizations_customer', ['tenantId', 'customerPersonId', 'expiresAt'])
export class CustomerCreditAuthorizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36 })
  customerPersonId!: string;

  @Column({ name: 'max_amount', type: 'decimal', precision: 14, scale: 2 })
  maxAmount!: string;

  @Column({ type: 'varchar', length: 200 })
  reason!: string;

  @Column({ name: 'expires_at', type: 'timestamp', precision: 6 })
  expiresAt!: Date;

  @Column({ name: 'authorized_by_user_id', type: 'varchar', length: 36 })
  authorizedByUserId!: string;

  @Column({ name: 'used_sale_id', type: 'varchar', length: 36, nullable: true })
  usedSaleId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
