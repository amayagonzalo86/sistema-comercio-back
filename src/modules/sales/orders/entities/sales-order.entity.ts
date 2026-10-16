import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BranchEntity } from '../../../branches/entities/branch.entity';
import { TenantEntity } from '../../../platform/entities/tenant.entity';
import { SalesOrderItemEntity } from './sales-order-item.entity';

export enum SalesOrderStatus {
  /** Armado por el vendedor; el cliente todavía no pagó en caja. */
  PENDING = 'PENDING',
  /** Cobrado en caja: generó una venta (sale_id). */
  CHARGED = 'CHARGED',
  CANCELLED = 'CANCELLED',
}

@Entity('sales_orders')
@Index('UQ_sales_orders_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('UQ_sales_orders_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_sales_orders_queue', ['tenantId', 'branchId', 'status', 'createdAt'])
@Index('IDX_sales_orders_seller', ['tenantId', 'sellerUserId', 'createdAt'])
export class SalesOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_sales_orders_tenant' })
  tenant?: TenantEntity;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @ManyToOne(() => BranchEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'branch_id', foreignKeyConstraintName: 'FK_sales_orders_branch' })
  branch?: BranchEntity;

  /** Número correlativo por empresa: es el que el cliente le dice al cajero. */
  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36, nullable: true })
  customerPersonId?: string | null;

  @Column({ name: 'seller_user_id', type: 'varchar', length: 36 })
  sellerUserId!: string;

  @Column({ type: 'enum', enum: SalesOrderStatus, default: SalesOrderStatus.PENDING })
  status!: SalesOrderStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes?: string | null;

  /** Lista de precios elegida por el vendedor (la caja cobra con esa lista). */
  @Column({ name: 'price_list_id', type: 'varchar', length: 36, nullable: true })
  priceListId?: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'voucher_class', type: 'char', length: 1, nullable: true })
  voucherClass?: string | null;

  /** Total al armar el pedido. El cobro recalcula con los precios y promociones vigentes en ese momento. */
  @Column({ name: 'estimated_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  estimatedTotal!: string;

  @Column({ name: 'items_count', type: 'int', unsigned: true, default: 0 })
  itemsCount!: number;

  @Column({ name: 'sale_id', type: 'varchar', length: 36, nullable: true })
  saleId?: string | null;

  @Column({ name: 'charged_by_user_id', type: 'varchar', length: 36, nullable: true })
  chargedByUserId?: string | null;

  @Column({ name: 'charged_at', type: 'timestamp', precision: 6, nullable: true })
  chargedAt?: Date | null;

  @Column({ name: 'cancelled_by_user_id', type: 'varchar', length: 36, nullable: true })
  cancelledByUserId?: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', precision: 6, nullable: true })
  cancelledAt?: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 200, nullable: true })
  cancelReason?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @OneToMany(() => SalesOrderItemEntity, (item) => item.order)
  items!: SalesOrderItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
