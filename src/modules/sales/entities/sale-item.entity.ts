import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sale_items')
@Index('IDX_sale_items_tenant_sale', ['tenantId', 'saleId'])
export class SaleItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'sale_id', type: 'varchar', length: 36 })
  saleId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @Column({ name: 'sku_snapshot', type: 'varchar', length: 50 })
  skuSnapshot!: string;

  @Column({ name: 'name_snapshot', type: 'varchar', length: 150 })
  nameSnapshot!: string;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: string;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2 })
  taxRate!: string;

  @Column({ name: 'net_amount', type: 'decimal', precision: 14, scale: 2 })
  netAmount!: string;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 14, scale: 2 })
  taxAmount!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;
}
