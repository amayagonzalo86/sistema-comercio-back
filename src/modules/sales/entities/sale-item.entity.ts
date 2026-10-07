import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { VatTreatment } from '../../fiscal/vat/vat';

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

  @Column({ name: 'vat_treatment', type: 'varchar', length: 20, nullable: true })
  vatTreatment?: VatTreatment | null;

  // Id ARCA de la alícuota aplicada (5 = 21 %, 4 = 10,5 %, ...). Null si no se cobró IVA.
  @Column({ name: 'arca_vat_rate_id', type: 'smallint', unsigned: true, nullable: true })
  arcaVatRateId?: number | null;

  @Column({ name: 'price_includes_vat', type: 'boolean', default: false })
  priceIncludesVat!: boolean;

  @Column({ name: 'exempt_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  exemptAmount!: string;

  @Column({ name: 'not_taxed_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  notTaxedAmount!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  /** Costo unitario del producto al momento de la venta (margen real en reportes). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 12, scale: 2, default: 0 })
  unitCost!: string;
}
