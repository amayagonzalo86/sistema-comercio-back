import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProductEntity } from '../../../inventory/product/entities/product.entity';
import { PriceListEntity } from './price-list.entity';

@Entity('product_price_lists')
@Index('IDX_UNIQUE_TENANT_PL_PRODUCT', ['tenantId', 'priceListId', 'productId'], { unique: true })
export class ProductPriceListEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'price_list_id', type: 'varchar', length: 36 })
  priceListId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @Column({
    name: 'applied_percentage',
    type: 'decimal',
    precision: 7,
    scale: 2,
    comment: 'Porcentaje real registrado y recalculado por la regla de negocio',
  })
  appliedPercentage!: number;

  @ManyToOne(() => PriceListEntity, (pl) => pl.productOverrides, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'price_list_id' })
  priceList!: PriceListEntity;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: ProductEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

