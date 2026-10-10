import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProductEntity } from '../../../inventory/product/entities/product.entity';
import { StockTransferEntity } from './stock-transfer.entity';

@Entity('stock_transfer_items')
@Index('IDX_stock_transfer_items_transfer', ['tenantId', 'transferId'])
@Index('IDX_stock_transfer_items_product', ['tenantId', 'productId'])
export class StockTransferItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'transfer_id', type: 'varchar', length: 36 })
  transferId!: string;

  @ManyToOne(() => StockTransferEntity, (transfer) => transfer.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transfer_id', foreignKeyConstraintName: 'FK_stock_transfer_items_transfer' })
  transfer!: StockTransferEntity;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_stock_transfer_items_product' })
  product?: ProductEntity;

  @Column({ name: 'sku_snapshot', type: 'varchar', length: 50 })
  skuSnapshot!: string;

  @Column({ name: 'name_snapshot', type: 'varchar', length: 150 })
  nameSnapshot!: string;

  @Column({ name: 'quantity_sent', type: 'decimal', precision: 12, scale: 3 })
  quantitySent!: string;

  @Column({ name: 'quantity_received', type: 'decimal', precision: 12, scale: 3, nullable: true })
  quantityReceived?: string | null;

  /** Costo unitario en origen al despachar (valoriza el stock en tránsito y las diferencias). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 12, scale: 2 })
  unitCost!: string;
}
