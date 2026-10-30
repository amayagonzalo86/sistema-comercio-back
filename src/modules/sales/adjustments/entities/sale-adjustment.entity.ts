import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Nota de crédito (descuenta) o de débito (agrega) sobre una venta facturada, sin mover mercadería. */
export enum SaleAdjustmentKind {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

/**
 * Cómo se liquida la nota.
 * - Crédito: CASH = se devuelve efectivo de la caja; OTHER = reverso en tarjeta/transferencia; NONE = saldo a favor.
 * - Débito: CASH = se cobra en efectivo en la caja; OTHER = se cobra con otro medio; NONE = queda pendiente de cobro.
 */
export enum SaleAdjustmentSettlement {
  CASH = 'CASH',
  OTHER = 'OTHER',
  NONE = 'NONE',
}

@Entity('sale_adjustments')
@Index('UQ_sale_adjustments_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('UQ_sale_adjustments_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_sale_adjustments_sale', ['tenantId', 'saleId'])
export class SaleAdjustmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'sale_id', type: 'varchar', length: 36 })
  saleId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ type: 'enum', enum: SaleAdjustmentKind })
  kind!: SaleAdjustmentKind;

  /** Concepto que se imprime en el comprobante ("Bonificación por pronto pago", "Cheque rechazado N.º 123"). */
  @Column({ type: 'varchar', length: 150 })
  concept!: string;

  /** Motivo interno (auditoría). */
  @Column({ type: 'varchar', length: 200 })
  reason!: string;

  /** Alícuota aplicada (21.00, 10.50…); 0 si no lleva IVA. */
  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate!: string;

  @Column({ name: 'arca_vat_rate_id', type: 'smallint', unsigned: true, nullable: true })
  arcaVatRateId?: number | null;

  @Column({ name: 'net_amount', type: 'decimal', precision: 14, scale: 2 })
  netAmount!: string;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 14, scale: 2 })
  taxAmount!: string;

  @Column({ name: 'exempt_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  exemptAmount!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: SaleAdjustmentSettlement })
  settlement!: SaleAdjustmentSettlement;

  @Column({ name: 'cash_session_id', type: 'varchar', length: 36, nullable: true })
  cashSessionId?: string | null;

  /** Referencia del cobro o reintegro con otro medio (cupón, transferencia, cheque). */
  @Column({ name: 'external_reference', type: 'varchar', length: 100, nullable: true })
  externalReference?: string | null;

  @Column({ name: 'fiscal_status', type: 'varchar', length: 20, default: 'NOT_ISSUED' })
  fiscalStatus!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
