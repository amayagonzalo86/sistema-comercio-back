import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';
import { ProductPriceListEntity } from '../../../sales/price-list/entities/product-price-list.entity';
import { ProductBranchEntity } from './product-branch.entity';
import { TenantEntity } from '../../../platform/entities/tenant.entity';
import { VatTreatment } from '../../../fiscal/vat/vat';

export enum UnitOfMeasure {
  UNIT = 'UNIT',
  KG = 'KG',
  LITER = 'LITER',
  METER = 'METER',
  PACK = 'PACK',
}

// Transformador numérico para TypeORM decimal -> number
const columnNumericTransformer = {
  to: (data: number): number => data,
  from: (data: string): number => parseFloat(data),
};

@Entity('products')
@Index('UQ_products_tenant_sku', ['tenantId', 'sku'], { unique: true })
@Index('UQ_products_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('IDX_products_tenant_barcode', ['tenantId', 'barcode'])
@Index('IDX_products_tenant_category', ['tenantId', 'category'])
@Index('IDX_products_tenant_brand', ['tenantId', 'brand'])
@Index(['barcode'])
export class ProductEntity {
  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  sku!: string;

  @Column({ name: 'barcode', type: 'varchar', length: 100, nullable: true })
  barcode?: string | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  brand?: string | null;

  @Column({ name: 'unit_of_measure', type: 'enum', enum: UnitOfMeasure, default: UnitOfMeasure.UNIT })
  unitOfMeasure!: UnitOfMeasure;

  // Alícuota de IVA en porcentaje (0, 2.5, 5, 10.5, 21 o 27). Siempre 0 si el producto es exento o no gravado.
  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 21.0, transformer: columnNumericTransformer })
  taxRate!: number;

  @Column({ name: 'vat_treatment', type: 'enum', enum: VatTreatment, default: VatTreatment.TAXED })
  vatTreatment!: VatTreatment;

  // true: el precio de venta cargado es final (IVA incluido). false: el precio es neto y el IVA se suma.
  @Column({ name: 'price_includes_vat', type: 'boolean', default: false })
  priceIncludesVat!: boolean;

  @Column({ type: 'boolean', default: true })
  status!: boolean;

  @OneToMany(() => ProductBranchEntity, (pb) => pb.product, { cascade: true })
  branchSettings!: ProductBranchEntity[];

  @OneToMany(() => ProductPriceListEntity, (ppl) => ppl.product)
  priceOverrides!: ProductPriceListEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}