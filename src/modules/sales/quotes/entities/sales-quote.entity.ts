import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BranchEntity } from '../../../branches/entities/branch.entity';
import { TenantEntity } from '../../../platform/entities/tenant.entity';

/** Renglón congelado del presupuesto (precio y promoción vigentes al emitirlo). */
export interface SalesQuoteLine {
  productId: string;
  sku: string;
  name: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  total: string;
}

/** Presupuesto "X": no es un comprobante fiscal; vence a las 24 h y se borra. */
@Entity('sales_quotes')
@Index('UQ_sales_quotes_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_sales_quotes_tenant_number', ['tenantId', 'number'])
@Index('IDX_sales_quotes_seller', ['tenantId', 'sellerUserId', 'createdAt'])
@Index('IDX_sales_quotes_expires', ['expiresAt'])
export class SalesQuoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_sales_quotes_tenant' })
  tenant?: TenantEntity;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @ManyToOne(() => BranchEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'branch_id', foreignKeyConstraintName: 'FK_sales_quotes_branch' })
  branch?: BranchEntity;

  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'seller_user_id', type: 'varchar', length: 36 })
  sellerUserId!: string;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36, nullable: true })
  customerPersonId?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes?: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'voucher_class', type: 'char', length: 1, nullable: true })
  voucherClass?: string | null;

  @Column({ name: 'vat_regime', type: 'varchar', length: 20 })
  vatRegime!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  subtotal!: string;

  @Column({ name: 'tax_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  taxTotal!: string;

  @Column({ name: 'discount_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  discountTotal!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  total!: string;

  @Column({ name: 'lines', type: 'json' })
  lines!: SalesQuoteLine[];

  @Column({ name: 'expires_at', type: 'timestamp', precision: 6 })
  expiresAt!: Date;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
