import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProductEntity } from '../../inventory/product/entities/product.entity';
import { PurchaseOrderEntity } from './purchase-order.entity';

@Entity('purchase_order_items')
@Index('IDX_purchase_order_items_order', ['tenantId', 'purchaseOrderId'])
@Index('IDX_purchase_order_items_product', ['tenantId', 'productId'])
export class PurchaseOrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'purchase_order_id', type: 'varchar', length: 36 })
  purchaseOrderId!: string;

  @ManyToOne(() => PurchaseOrderEntity, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_order_id', foreignKeyConstraintName: 'FK_purchase_order_items_order' })
  order!: PurchaseOrderEntity;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_purchase_order_items_product' })
  product?: ProductEntity;

  @Column({ name: 'sku_snapshot', type: 'varchar', length: 50 })
  skuSnapshot!: string;

  @Column({ name: 'name_snapshot', type: 'varchar', length: 150 })
  nameSnapshot!: string;

  @Column({ name: 'quantity_ordered', type: 'decimal', precision: 12, scale: 3 })
  quantityOrdered!: string;

  @Column({ name: 'quantity_received', type: 'decimal', precision: 12, scale: 3, default: 0 })
  quantityReceived!: string;

  /** Costo unitario pactado, sin impuestos. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 12, scale: 2 })
  unitCost!: string;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 21 })
  taxRate!: string;
}
