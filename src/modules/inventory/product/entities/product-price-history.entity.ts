import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Historial de cambios de costo y precio por producto y sucursal (útil para analizar inflación y márgenes). */
@Entity('product_price_history')
@Index('IDX_price_history_product', ['tenantId', 'productId', 'createdAt'])
@Index('IDX_price_history_batch', ['tenantId', 'batchId'])
export class ProductPriceHistoryEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'old_cost_price', type: 'decimal', precision: 12, scale: 2 })
  oldCostPrice!: string;

  @Column({ name: 'new_cost_price', type: 'decimal', precision: 12, scale: 2 })
  newCostPrice!: string;

  @Column({ name: 'old_selling_price', type: 'decimal', precision: 12, scale: 2 })
  oldSellingPrice!: string;

  @Column({ name: 'new_selling_price', type: 'decimal', precision: 12, scale: 2 })
  newSellingPrice!: string;

  @Column({ type: 'varchar', length: 200 })
  reason!: string;

  // Agrupa las filas de un mismo ajuste masivo.
  @Column({ name: 'batch_id', type: 'varchar', length: 36, nullable: true })
  batchId?: string | null;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
