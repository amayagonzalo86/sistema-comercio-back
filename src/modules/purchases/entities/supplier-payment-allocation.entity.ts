import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('supplier_payment_allocations')
@Index('UQ_supplier_payment_allocations_tenant_payment_payable', ['tenantId', 'paymentId', 'payableId'], { unique: true })
@Index('IDX_supplier_payment_allocations_tenant_payable', ['tenantId', 'payableId'])
export class SupplierPaymentAllocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'payment_id', type: 'varchar', length: 36 })
  paymentId!: string;

  @Column({ name: 'payable_id', type: 'varchar', length: 36 })
  payableId!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;
}
