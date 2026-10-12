import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProductEntity } from '../../../inventory/product/entities/product.entity';
import { SalesOrderEntity } from './sales-order.entity';

@Entity('sales_order_items')
@Index('IDX_sales_order_items_order', ['tenantId', 'salesOrderId'])
export class SalesOrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'sales_order_id', type: 'varchar', length: 36 })
  salesOrderId!: string;

  @ManyToOne(() => SalesOrderEntity, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sales_order_id', foreignKeyConstraintName: 'FK_sales_order_items_order' })
  order!: SalesOrderEntity;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_sales_order_items_product' })
  product?: ProductEntity;

  @Column({ name: 'sku_snapshot', type: 'varchar', length: 50 })
  skuSnapshot!: string;

  @Column({ name: 'name_snapshot', type: 'varchar', length: 150 })
  nameSnapshot!: string;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: string;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  discountAmount!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;
}
