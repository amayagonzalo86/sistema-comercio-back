import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('purchase_receipts')
@Index('UQ_purchase_receipts_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_purchase_receipts_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_purchase_receipts_tenant_branch_created', ['tenantId', 'branchId', 'createdAt'])
@Index('IDX_purchase_receipts_order', ['tenantId', 'purchaseOrderId'])
export class PurchaseReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'supplier_person_id', type: 'varchar', length: 36 })
  supplierPersonId!: string;

  @Column({ name: 'purchase_order_id', type: 'varchar', length: 36, nullable: true })
  purchaseOrderId?: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'source_document_type', type: 'varchar', length: 30, nullable: true })
  sourceDocumentType?: string | null;

  @Column({ name: 'source_document_number', type: 'varchar', length: 80, nullable: true })
  sourceDocumentNumber?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  subtotal!: string;

  @Column({ name: 'tax_total', type: 'decimal', precision: 14, scale: 2 })
  taxTotal!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
