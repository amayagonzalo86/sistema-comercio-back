import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('supplier_payables')
@Index('UQ_supplier_payables_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_supplier_payables_tenant_receipt', ['tenantId', 'purchaseReceiptId'], { unique: true })
@Index('IDX_supplier_payables_tenant_supplier_due', ['tenantId', 'supplierPersonId', 'dueDate', 'createdAt'])
@Index('IDX_supplier_payables_tenant_branch_created', ['tenantId', 'branchId', 'createdAt', 'id'])
export class SupplierPayableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'supplier_person_id', type: 'varchar', length: 36 })
  supplierPersonId!: string;

  @Column({ name: 'purchase_receipt_id', type: 'varchar', length: 36 })
  purchaseReceiptId!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'original_amount', type: 'decimal', precision: 14, scale: 2 })
  originalAmount!: string;

  // Materialized balance; changed only while holding the payable row lock.
  @Column({ name: 'amount_paid', type: 'decimal', precision: 14, scale: 2, default: 0 })
  amountPaid!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
