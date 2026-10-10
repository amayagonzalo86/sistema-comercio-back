import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { PersonEntity } from '../../persons/entities/person.entity';
import { PurchaseOrderItemEntity } from './purchase-order-item.entity';

export enum PurchaseOrderStatus {
  /** Borrador editable. */
  DRAFT = 'DRAFT',
  /** Enviado al proveedor; esperando mercadería. */
  SENT = 'SENT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

@Entity('purchase_orders')
@Index('UQ_purchase_orders_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('IDX_purchase_orders_tenant_status', ['tenantId', 'status', 'createdAt'])
@Index('IDX_purchase_orders_supplier', ['tenantId', 'supplierPersonId', 'createdAt'])
@Index('IDX_purchase_orders_branch', ['tenantId', 'branchId', 'createdAt'])
export class PurchaseOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_purchase_orders_tenant' })
  tenant?: TenantEntity;

  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'supplier_person_id', type: 'varchar', length: 36 })
  supplierPersonId!: string;

  @ManyToOne(() => PersonEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'supplier_person_id', foreignKeyConstraintName: 'FK_purchase_orders_supplier' })
  supplier?: PersonEntity;

  /** Sucursal donde se recibirá la mercadería. */
  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @ManyToOne(() => BranchEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'branch_id', foreignKeyConstraintName: 'FK_purchase_orders_branch' })
  branch?: BranchEntity;

  @Column({ type: 'enum', enum: PurchaseOrderStatus, default: PurchaseOrderStatus.DRAFT })
  status!: PurchaseOrderStatus;

  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Total estimado (neto + IVA) según los costos pactados. */
  @Column({ name: 'estimated_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  estimatedTotal!: string;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36 })
  createdByUserId!: string;

  @Column({ name: 'sent_at', type: 'timestamp', precision: 6, nullable: true })
  sentAt?: Date | null;

  @Column({ name: 'closed_at', type: 'timestamp', precision: 6, nullable: true })
  closedAt?: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 200, nullable: true })
  cancelReason?: string | null;

  @OneToMany(() => PurchaseOrderItemEntity, (item) => item.order)
  items!: PurchaseOrderItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
