import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { VatChargeMode, VatExemptionReason, VoucherClass } from '../../fiscal/vat/vat';

export enum SaleFiscalStatus {
  NOT_ISSUED = 'NOT_ISSUED',
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

@Entity('sales')
@Index('UQ_sales_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_sales_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_sales_tenant_branch_created', ['tenantId', 'branchId', 'createdAt'])
export class SaleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36, nullable: true })
  customerPersonId?: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  // Suma de importes sin IVA (neto gravado + exento + no gravado).
  @Column({ type: 'decimal', precision: 14, scale: 2 })
  subtotal!: string;

  // IVA total de la operación.
  @Column({ name: 'tax_total', type: 'decimal', precision: 14, scale: 2 })
  taxTotal!: string;

  @Column({ name: 'net_taxed_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  netTaxedTotal!: string;

  @Column({ name: 'exempt_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  exemptTotal!: string;

  @Column({ name: 'not_taxed_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  notTaxedTotal!: string;

  // Clase de comprobante que corresponde (A, B, C o E). Null en ventas anteriores a esta versión.
  @Column({ name: 'voucher_class', type: 'char', length: 1, nullable: true })
  voucherClass?: VoucherClass | null;

  @Column({ name: 'vat_charge_mode', type: 'varchar', length: 30, nullable: true })
  vatChargeMode?: VatChargeMode | null;

  // Snapshots fiscales al momento de la venta (no cambian si luego se edita la empresa o el cliente).
  @Column({ name: 'issuer_vat_condition', type: 'varchar', length: 40, nullable: true })
  issuerVatCondition?: string | null;

  @Column({ name: 'customer_vat_condition', type: 'varchar', length: 40, nullable: true })
  customerVatCondition?: string | null;

  @Column({ name: 'vat_exemption_reason', type: 'varchar', length: 30, nullable: true })
  vatExemptionReason?: VatExemptionReason | null;

  @Column({ name: 'vat_exemption_note', type: 'varchar', length: 200, nullable: true })
  vatExemptionNote?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ name: 'fiscal_status', type: 'enum', enum: SaleFiscalStatus, default: SaleFiscalStatus.NOT_ISSUED })
  fiscalStatus!: SaleFiscalStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
