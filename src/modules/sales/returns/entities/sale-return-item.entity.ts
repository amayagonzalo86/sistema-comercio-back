import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SaleItemEntity } from '../../entities/sale-item.entity';
import { SaleReturnEntity } from './sale-return.entity';

@Entity('sale_return_items')
@Index('IDX_sale_return_items_return', ['tenantId', 'saleReturnId'])
@Index('IDX_sale_return_items_sale_item', ['tenantId', 'saleItemId'])
export class SaleReturnItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'sale_return_id', type: 'varchar', length: 36 })
  saleReturnId!: string;

  @ManyToOne(() => SaleReturnEntity, (saleReturn) => saleReturn.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_return_id', foreignKeyConstraintName: 'FK_sale_return_items_return' })
  saleReturn!: SaleReturnEntity;

  @Column({ name: 'sale_item_id', type: 'varchar', length: 36 })
  saleItemId!: string;

  @ManyToOne(() => SaleItemEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'sale_item_id', foreignKeyConstraintName: 'FK_sale_return_items_sale_item' })
  saleItem?: SaleItemEntity;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;

  @Column({ name: 'net_amount', type: 'decimal', precision: 14, scale: 2 })
  netAmount!: string;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 14, scale: 2 })
  taxAmount!: string;

  @Column({ name: 'exempt_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  exemptAmount!: string;

  @Column({ name: 'not_taxed_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  notTaxedAmount!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  /** Costo unitario de la venta original (para revertir el margen en los reportes). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 12, scale: 2, default: 0 })
  unitCost!: string;
}
