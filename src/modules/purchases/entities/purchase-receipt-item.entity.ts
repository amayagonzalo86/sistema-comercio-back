import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('purchase_receipt_items')
@Index('UQ_purchase_receipt_items_tenant_receipt_product', ['tenantId', 'purchaseReceiptId', 'productId'], { unique: true })
@Index('IDX_purchase_receipt_items_tenant_product', ['tenantId', 'productId'])
export class PurchaseReceiptItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'purchase_receipt_id', type: 'varchar', length: 36 })
  purchaseReceiptId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @Column({ name: 'sku_snapshot', type: 'varchar', length: 50 })
  skuSnapshot!: string;

  @Column({ name: 'name_snapshot', type: 'varchar', length: 150 })
  nameSnapshot!: string;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;

  @Column({ name: 'unit_cost', type: 'decimal', precision: 12, scale: 2 })
  unitCost!: string;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2 })
  taxRate!: string;

  @Column({ name: 'net_amount', type: 'decimal', precision: 14, scale: 2 })
  netAmount!: string;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 14, scale: 2 })
  taxAmount!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;
}
